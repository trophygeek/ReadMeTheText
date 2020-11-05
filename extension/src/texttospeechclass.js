'use strict';
import {jsonParseSafe, logerr, PLAYBACKSTATE, sha1, trace} from "./misc.js";

/**
 * The background thread creates an instance of this and the popup menu and toolbar menu
 * and options page message the backend to play text.
 *
 * Large text is a problem.
 *  - Slow startup times because of WHOLE block of text is sent to server and sound is downloaded
 *  - Canceling playback part way through still consumes the whole quota because all the text was sent
 *  - Memory pressure is higher because older blocks of sound can't be purged if needed.
 *
 *  "Double-buffering" is the answer.
 *
 *  Challenges:
 *  - figuring out where to split text because of pauses in natural speech.
 *    Sentences and paragraphs have a natural pause built into wavenet. If we split up text, then we can screw
 *    that up (no pause or too long of a pause)
 *  - Pausing playback near boundries of buffered sound.
 *    Right now, when you pause,restart a sound playback, it skips back just a bit, if this skipback falls at
 *    buffer boundry, then we'll only go back to the start of that buffer.
 *  - If we pause but we have 5 of 10 text segments fetched, then unpausing needs to keep playing #5
 *    then keep going, playing and fetching. We play #5, start #6 and see there's no #7, so we start prefetching.
 *  - If we stop but we have 5 of 10 text segments fetched, then we need to start playing again at #0, then keep
 *    fetching like we did for pause.
 *  - Say the network is REALLY slow and when we reach the end of playing a segment, the next one isn't fetched yet?
 *    The playback needs to block until it's ready, then continue on it's normal way.
 *
 */
export class classTextToSpeech {
  /** @var {AudioContext} **/
  _audioCtx = null;
  /** @var {AudioBufferSourceNode} **/
  _trackSource = null;
  _pausedoffset = 0;
  _skipBackOnUnpause = 0.5; // todo: move to settings

  /** var string[] **/
  _textParts = [];    // we pop these off as they are fetched.
  _buffers_decoded = [];
  _buffer_ii = 0;

  /** Promise **/
  _nextFetchPromise = null;
  _isPaused = false;
  _isStopped = false;

  _currentPlaybackstate = PLAYBACKSTATE.IDLE;
  /** @var {function} **/
  _eventChangeCallback_fn = null;
  /** @var {function} **/
  _quotaIncCallback_fn = null;
  _lasterr = '';

  _apikey = '';
  _audioConfig = {};
  _voice = {};


  _prev_text_checksum = '';  // use to avoid refetching same data.
  _prev_settings_checksum = '';    // used to know if voice shouldn't be cached because settings changed


  /**
   * @param apikey {string}  Settings.apiKey
   * @param eventChangeFunc {function}  Called when states changes.
   * @param quotaIncFunc {function}  Called with int each time data was sent to api
   */
  constructor(apikey = '', eventChangeFunc, quotaIncFunc) {
    this._apikey = apikey;
    this._eventChangeCallback_fn = eventChangeFunc;
    this._quotaIncCallback_fn = quotaIncFunc;
  }

  /**
   *
   * @param audioConfig {audioEncoding:{string}, effectsProfileId:{string}, pitch: {string}, speakingRate: {string}}
   * @param voice {languageCode:{string}, name:{string}}
   */
  setVoice(audioConfig, voice) {
    this._audioConfig = audioConfig;
    this._voice = voice;
  }

  /**
   * removes consecutive whitespace to reduce size of text sent to google.
   * @param testinput {string}
   * @return {string}
   * @static
   */
  cleanupText(testinput) {
    // sending multiple spaces eats up our quota, so we reduce runs of whitespace to a single space.
    testinput = testinput.replace(/(\s)\1+/g, '  ');   // remove more than two spaces to just two
    return testinput;
  }

  /**
   *
   * @return {string}
   */
  getLastError() {
    return this._lasterr;
  }

  /**
   *
   * @param err_str {string}
   */
  _setLastError(err_str) {
    this.setPlaybackState(PLAYBACKSTATE.ERROR);
    this._lasterr = err_str;
  }


  /*
   * @param text {string}
   * @return {string[]}
   * @private
   */
  _splitTextIntoParts(text) {
    const IDEAL_MESSAGE_SIZE = 400;
    const TOO_SMALL_MESSAGE_SIZE = 24;

    const paragraphs = text.split('  ');  // test by sending each sentence

    // if there are any small paragraphs, merge them up.
    if (paragraphs.length === 1) {
      return [text];
    }
    
    const results = [];
    let nextmerge = paragraphs[0];
    for (var ii=1; ii<paragraphs.length; ii++) {
      const next = paragraphs[ii];
      if (nextmerge.length + next.length < IDEAL_MESSAGE_SIZE
          || next.length < TOO_SMALL_MESSAGE_SIZE) {
        nextmerge = `${nextmerge}  ${next}`;
      } else {
        // would be too big, skip
        results.push(nextmerge);
        nextmerge = paragraphs[ii];
      }
    }

    // handle remainder
    if (nextmerge) {
      results.push(nextmerge);
    }
    return results;
  }

  /**
   * Sends request to texttospeech api and process the result.
   * Probably want to call _fetchNext()
   *
   * @param text
   * @return {Promise<boolean>}
   */
  async _fetchAudioData(text) {
    trace(`_fetchAudioData '${text}'`);
    try {
      const charactercount = text.length;
      const url = `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${this._apikey}`;

      const message = {
        audioConfig: this._audioConfig,
        voice: this._voice,
        input: {
          text: text
        }
      }

      const response = await fetch(url, {
        method: 'post',
        body: JSON.stringify(message),
        referrer: `https://${chrome.runtime.id}`,   // could be used to restrict api on server
      }).catch((err) => {
        throw Error(err.message);
      });

      // todo: In general, Google Cloud will return a HTTP 429 error code if you're using
      //  HTTP/REST to access the service, or ResourceExhausted

      if (!response.ok) {
        logerr('server response was not ok ', response);
        const err = jsonParseSafe(await response.text());
        this._setLastError(err.error.message);
        return false;
      }

      const data = jsonParseSafe(await response.text());

      // result data layout
      // {
      //   audioContent: string,
      //   timepoints: [ {Timepoint) } ],
      //   audioConfig: {AudioConfig}
      // }

      // convert the audio data into an arrayBuffer.
      {
        const buffer = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0)).buffer;
        const audioCtx = new AudioContext();
        const decodedbuffer = await audioCtx.decodeAudioData(buffer); // this detaches the buffer.
        await audioCtx.close();

        this._buffers_decoded.push(decodedbuffer);
      }

      if (this._quotaIncCallback_fn) {
        this._quotaIncCallback_fn(charactercount);
      }
      return true;
    } catch (err) {
      logerr(err, err.stack);
      this._setLastError(err.toString());
      return false;
    }
  }

  /**
   * Just fetches the next chunk of text if we're running low on unused playback buffers.
   * @return {Promise<void>}
   * @private
   */
  async _fetchNext() {
    try {
      trace(`_fetchNext bufferlen:${this._buffers_decoded.length}   index: ${this._buffer_ii}`);
      // queue up next fetch if we've used up your pre-fretched buffer
      // start fetching the next clip so the buffer is ready.
      if (this._textParts.length
          && (this._buffer_ii === this._buffers_decoded.length)) {
        trace('fetching next text bit');
        if (this._nextFetchPromise) {
          await (this._nextFetchPromise);
          this._nextFetchPromise = null;
        }

        // the playback will wait on this THIS promise.
        const nexttext = this._textParts.shift();
        if (nexttext.trim() !== '') {
          this._nextFetchPromise = this._fetchAudioData(nexttext);   // do not await.
        }
      }
    } catch (err) {
      logerr(err, err.stack);
    }
  };

  /**
   * Trivial check to see if settings changed since we last played a voice so we know to NOT cache it.
   * @return {boolean}
   * @private
   */
  async _checksumAndCheckIfSettingsChanged() {
    const data = JSON.stringify({apikey: this._apikey, voice: this._voice, audioConfig: this._audioConfig});
    const newchecksum = await sha1(data);
    const result = (this._prev_settings_checksum !== newchecksum);
    this._prev_settings_checksum = newchecksum;
    return result;
  };

  /**
   *
   * @param text
   * @return {Promise<boolean>}
   * @private
   */
  async _checksumAndCheckIfTextChanged(text = '') {
    const newchecksum = await sha1(text);
    const result = (this._prev_text_checksum !== newchecksum);
    this._prev_text_checksum = newchecksum;
    return result;
  }

  async _onended({target}) {
    try {
      trace('ended', target);

      // is there any more text to fetch AND our playback buffer is empty
      const out_of_playback_buffers = this._buffer_ii === this._buffers_decoded.length;

      if (this._textParts.length === 0 && out_of_playback_buffers) {
        this._isStopped = true;
        trace(`_isStopped:${this._isStopped} && out_of_playback_buffers:${out_of_playback_buffers}`);
      }

      // need to check if we're paused/stopped
      if (this._isStopped) {
        trace(`stopping because this._isStopped is true.`);
        this.setPlaybackState(PLAYBACKSTATE.STOPPED);
        this._pausedoffset = 0;
        if (this._eventChangeCallback_fn) {
          queueMicrotask(this._eventChangeCallback_fn);     // use getPlaybackState to check state
        }
        return;
      }

      // need to start the next sound playback, but make sure it's loaded.
      if (this._nextFetchPromise) {
        trace(`waiting for _nextFetchPromise`);
        await Promise.all([this._nextFetchPromise]);
        this._nextFetchPromise = null;
      }

      // make sure nothing went wrong with the last fetch
      if (this.getLastError() !== '') {  // todo: verify the next buffer is available
        logerr('_onended getLastError() not empth', this.getLastError());
        this.setPlaybackState(PLAYBACKSTATE.ERROR);
        return;
      }

      const success = await this._playTracksChained();
      if (!success) {
        trace('_playTracksChained returned success:false');
        this.setPlaybackState(PLAYBACKSTATE.ERROR);
        return;
      }

      await this._fetchNext();
    } catch (err) {
      logerr(err, err.stack);
    }
  };

  _onstatechange({target}) {
    // Force state props to be re-sent to wrapped component
    trace('Audio state change ', target);
    switch (target.state) {
      case 'running':
        this.setPlaybackState(PLAYBACKSTATE.PLAYING);
        break;

      case 'suspended':
        this._pausedoffset = this._audioCtx.currentTime;
        this.setPlaybackState(PLAYBACKSTATE.PAUSED);
        break;

      case 'closed':
        this._pausedoffset = 0;
        this.setPlaybackState(PLAYBACKSTATE.STOPPED);
        break;
    }
  };

  /**
   *
   * @param text
   * @return {Promise<boolean>} success
   */
  async playTextToSpeech(text = '') {
    try {
      this.setPlaybackState(PLAYBACKSTATE.DOWNLOADING);

      // stop any prior sound playing?
      this._buffer_ii = 0;

      // if test==='' then we're replaying last text.
      if (text !== '') {
        const textclean = this.cleanupText(text);

        // see if the text is the same as last time
        const newtext = await this._checksumAndCheckIfTextChanged(text);
        // if settings changed, then we ignore caching.
        const settings_changed = await this._checksumAndCheckIfSettingsChanged();
        if (newtext || settings_changed) {
          this._textParts = this._splitTextIntoParts(textclean);
          if (this._textParts.length === 0) {
            logerr('parts after splitting is empty');
            this.setPlaybackState(PLAYBACKSTATE.ERROR);
            return false;
          }
          // since we're gonna reload the auto buffers, clear the old ones.
          this._buffers_decoded = [];
        }

        if (this._buffers_decoded.length === 0 && this._textParts.length > 0) {   // we need to fetch before playing.
          this.setPlaybackState(PLAYBACKSTATE.DOWNLOADING);
          const success = await this._fetchAudioData(this._textParts.shift());
          if (!success) {
            trace('_fetchAudioData returned success:false');
            this.setPlaybackState(PLAYBACKSTATE.ERROR);
            return false;
          }
        }
      }

      this._isStopped = false;
      this.setPlaybackState(PLAYBACKSTATE.PLAYING);
      await this._playTracksChained();     // when done playing it will play the next fetched clip and fetch another
      await this._fetchNext();
      return true;
    } catch (err) {
      logerr(err, err.stack);
      return false;
    }
  };

  /**
   *
   * @param unpause {boolean}  use the pause offset ot unpause
   * @return {Promise<boolean>}  // true if success
   * @private
   */
  async _playTracksChained(unpause = false) {
    try {
      // are we done?
      if ( (this._textParts.length===0)
          && (this._buffer_ii >= this._buffers_decoded)
      && !this._nextFetchPromise) {
        trace(`_playTracksChained not playing seems like we're done`);
        return;
      }

      if (this._nextFetchPromise) {   // will be null if we're REplaying already fetched content.
        await Promise.all([this._nextFetchPromise]);
        this._nextFetchPromise = null;
      }

      this._trackSource = null;   // release
      this._audioCtx = null;

      this._audioCtx = new AudioContext();  // pause/stop uses this.
      this._trackSource = this._audioCtx.createBufferSource();
      this._trackSource.buffer = this._buffers_decoded[this._buffer_ii];
      this._trackSource.connect(this._audioCtx.destination);

      this._audioCtx.addEventListener('statechange', ({target}) => {
        this._onstatechange({target});
      });
      this._trackSource.addEventListener('ended', ({target}) => {
        this._onended({target});
      });

      // _pausedoffset < Settings.skipBackOnUnpause means don't offset back to before beginning
      if (!unpause || this._pausedoffset < this._skipBackOnUnpause) {
        this._trackSource.start();
      } else {
        this._trackSource.start(0, this._pausedoffset - this._skipBackOnUnpause); // skip back 1sec
      }

      // bug where it can be in suspend mode?
      if (this._audioCtx && this._audioCtx.state !== 'suspended') {
        await this._audioCtx.resume();
      }

      this._buffer_ii++;

      await this._fetchNext();  // will only fetch if we're running low on unused buffers
      return true;
    } catch (err) {
      logerr(err, err.stack);
      this._setLastError(err.toString());
      return false;
    }
  }

  async pauseTrack() {
    try {
      if (this._audioCtx && this._audioCtx.state !== 'suspended') {
        await this._audioCtx.suspend();
      }
      this.setPlaybackState(PLAYBACKSTATE.PAUSED);
    } catch (err) {
      logerr(err, err.stack);
      this._setLastError(err.toString());
    }
  }

  async unpauseTrack() {
    try {
      if (this._audioCtx && this._audioCtx.state === 'suspended') {  // "closed" | "running" | "suspended";
        await this._audioCtx.resume();
        this.setPlaybackState(PLAYBACKSTATE.PLAYING);
        this._isStopped = false;
      }
    } catch (err) {
      logerr(err, err.stack);
      this._setLastError(err.toString());
    }
  }

  async stopTrack() {
    try {
      this._isStopped = true;
      if (![PLAYBACKSTATE.IDLE, PLAYBACKSTATE.STOPPED].includes(this.getPlaybackState())) {
        this.setPlaybackState(PLAYBACKSTATE.STOPPED);
      }
      if (this._audioCtx && this._audioCtx.state !== 'closed') {
        await this._audioCtx.close();
      }
      this._pausedoffset = 0;
    } catch (err) {
      logerr(err, err.stack);
      this._setLastError(err.toString());
    }
  }

  /**
   * @param newstate {string}
   */
  setPlaybackState(newstate) {
    try {
      if (newstate === PLAYBACKSTATE.ERROR) {
        debugger;
      }
      trace(`playback state change old:${this._currentPlaybackstate}  new:${newstate}`);
      const state_changed = (this._currentPlaybackstate !== newstate);
      this._currentPlaybackstate = newstate;
      if (this._eventChangeCallback_fn && state_changed) {
        this._eventChangeCallback_fn(newstate);     // use getPlaybackState to check state
      }
    } catch (err) {
      logerr(err, err.stack);
    }
  }

  /**
   *
   * @return {string}
   */
  getPlaybackState() {
    return this._currentPlaybackstate;
  }

  /**
   *
   * @return {Promise<boolean|*>}
   *
   * response data looks like this
   * {
  "voices": [
    {
      "languageCodes": [
        "de-DE"
      ],
      "name": "de-DE-Wavenet-F",
      "ssmlGender": "FEMALE",
      "naturalSampleRateHertz": 24000
    },
    {
      "languageCodes": [
        "en-GB"
      ],
      "name": "en-GB-Wavenet-F",
      "ssmlGender": "FEMALE",
      "naturalSampleRateHertz": 24000
    },
    ...
   */
  /**
   * @param apikey {string}
   * @return {Promise<string|boolean>}
   * @static
   */
  async apiFetchVoices(apikey = '') {
    try {
      if (apikey !== '') {
        logerr('API key not set');
        return false;
      }
      const url = `https://texttospeech.googleapis.com/v1beta1/voices?key=${apikey}`;
      const response = await fetch(url, {
        referrer: `https://${chrome.runtime.id}`,
      }).catch((err) => {
        throw Error(err.message);
      });
      if (!response.ok) {
        throw Error(response.statusText);
      }

      return await response.text();
    } catch (err) {
      logerr(err, err.stack);
      // this._setLastError(err.toString());
      return false;
    }
  }
}

