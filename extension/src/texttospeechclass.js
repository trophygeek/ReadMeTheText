'use strict';
import {Settings} from "./usersettings.js";
import {jsonParseSafe, logerr, PLAYBACKSTATE, trace} from "./misc.js";

/**
 * The background thread creates an instance of this and the popup menu and toolbar menu
 * use that instance to play voice.
 * The Options page uses a "test only" instance for verifying the api key.
 */
export class classTextToSpeech {
  /** @var {AudioContext} **/
  _audioCtx = null;
  /** @var {AudioBufferSourceNode} **/
  _trackSource = null;
  _pausedoffset = 0;
  _bufferArray = null;
  _decodedbuffer = null;
  _lastText = '';

  /** @var {string} **/
  _currentPlaybackstate = PLAYBACKSTATE.IDLE;
  /** @var {function} **/
  _eventChangeCallback_fn = null;
  /** @var {string} **/
  _lasterr = '';

  _prev_settings_checksum = '';    // used to know if voice shouldn't be cached because settings changed

  /**
   *
   * @param eventChangeFunc {function}
   */
  constructor(eventChangeFunc) {
    this._eventChangeCallback_fn = eventChangeFunc;
  }

  /**
   * removes consecutive whitespace to reduce size of text sent to google.
   * @param testinput {string}
   * @return {string}
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
   *
   * @return {Promise<string|boolean>}
   */
  async apiFetchVoices() {
    try {
      await Settings.init();
      const apikey = Settings.apiKey;
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
      this._setLastError(err.toString());
      return false;
    }
  }

  // see https://developer.mozilla.org/en-US/docs/Games/Techniques/Audio_for_Web_Games

  /**
   * Sends request to texttospeech api and process the result.
   * May return success and character count is still zero if the text matches the prior request
   *
   * todo: the params are ugly... I in the middle of decoupling it from the Settings.

   * @param text_to_speak
   * @param apikey string
   * @param audioConfig {audioEncoding:{string}, effectsProfileId:{string}, pitch: {string}, speakingRate: {string}}
   * @param voice {languageCode:{string}, name:{string}}
   * @return {Promise<{success: boolean, charactercount: number}>}
   */
  async apiFetchAudio(text_to_speak,
                      apikey = Settings.apiKey,
                      audioConfig = {
                        audioEncoding: Settings.data.audioEncoding,
                        effectsProfileId: Settings.data.effectsProfileId,
                        pitch: Settings.data.pitch,
                        speakingRate: Settings.data.speakingRate
                      },
                      voice = {
                        languageCode: Settings.data.languageCode,
                        name: Settings.currentVoiceName,
                      }) {
    try {
      // todo: warn for really large text.
      const textclean = this.cleanupText(text_to_speak);

      let charactercount = 0;   // this may be zero if it's the same text since we dont' resend it.
      // optimization, if the old text === new text and we have a buffer, don't call google
      if (this._lastText === textclean && this._decodedbuffer !== null && !this._checksumAndCheckIfChanged()) {
        trace('apiFetchAudio would fetch the same data, so just not doing any new work');
        return {success: true, charactercount: 0};
      }

      await Settings.init();
      this._lastText = textclean;   // save for next time.
      charactercount = textclean.length;

      const url = `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apikey}`;

      const message = {
        audioConfig,
        voice,
        input: {
          text: textclean
        }
      }

      this.setPlaybackState(PLAYBACKSTATE.DOWNLOADING);
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
        const err = jsonParseSafe(await response.text());
        this._lasterr = err.error.message;
        logerr('server response was not ok ', err, response);
        return {success: false, charactercount: 0};
      }

      this._checksumAndCheckIfChanged(); // this is to save the current settings
      const data = jsonParseSafe(await response.text());

      // result data layout
      // {
      //   audioContent: string,
      //   timepoints: [ {Timepoint) } ],
      //   audioConfig: {AudioConfig}
      // }

      // convert the audio data into an arrayBuffer.
      this._bufferArray = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0)).buffer;
      return {success: true, charactercount};
    } catch (err) {
      logerr(err, err.stack);
      this._setLastError(err.toString());
      return {success: false, charactercount: 0};
    }
  }

  /**
   * Trivial check to see if settings changed since we last played a voice so we know to NOT cache it.
   * @return {boolean}
   * @private
   */
  _checksumAndCheckIfChanged() {
    const newchecksum = `${Settings.data._voice_name}.${Settings.data.audioEncoding}.${Settings.data.effectsProfileId}
${Settings.data.pitch}.${Settings.data.speakingRate}`;
    const result = (this._prev_settings_checksum !== newchecksum);
    trace(`_checksumAndCheckIfChanged  
                  OLD:'${this._prev_settings_checksum}
                  NEW:'${newchecksum}'`);
    this._prev_settings_checksum = newchecksum;
    return result;
  };

  _onended({target}) {
    trace('ended', target);
    this.setPlaybackState(PLAYBACKSTATE.STOPPED);
    this._pausedoffset = 0;
    if (this._eventChangeCallback_fn) {
      queueMicrotask(this._eventChangeCallback_fn);     // use getPlaybackState to check state
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
   * @param resume {boolean}
   * @return {Promise<boolean>}  // true if success
   */
  async playTrack(resume = false) {
    try {
      this.setPlaybackState(PLAYBACKSTATE.PLAYING);
      this._trackSource = null;   // release
      this._audioCtx = null;

      this._audioCtx = new AudioContext(); // need to free/reallocate?
      this._trackSource = this._audioCtx.createBufferSource();
      if (this._bufferArray.byteLength !== 0) { // it's been detached!
        this._decodedbuffer = await this._audioCtx.decodeAudioData(this._bufferArray); // this detaches the buffer.
      }

      this._trackSource.buffer = this._decodedbuffer;
      this._trackSource.connect(this._audioCtx.destination);

      this._audioCtx.addEventListener('statechange', ({target}) => this._onstatechange({target}));
      this._trackSource.addEventListener('ended', ({target}) => this._onended({target}));

      // _pausedoffset < Settings.skipBackOnUnpause means don't offset back to before beginning
      if (!resume || this._pausedoffset < Settings.data.skipBackOnUnpause) {
        this._trackSource.start();
      } else {
        this._trackSource.start(0, this._pausedoffset - Settings.data.skipBackOnUnpause); // skip back 1sec
      }

      // bug where it can be in suspend mode?
      if (this._audioCtx && this._audioCtx.state !== 'suspended') {
        await this._audioCtx.resume();
      }
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
        // await this._audioCtx.resume();
        this.setPlaybackState(PLAYBACKSTATE.PLAYING);
        await this.playTrack(true);
      }
    } catch (err) {
      logerr(err, err.stack);
      this._setLastError(err.toString());
    }
  }

  async stopTrack() {
    try {
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
      trace(`playback state change old:${this._currentPlaybackstate}  new:${newstate}`);
      const state_changed = (this._currentPlaybackstate !== newstate);
      this._currentPlaybackstate = newstate;
      if (this._eventChangeCallback_fn && state_changed) {
        queueMicrotask(this._eventChangeCallback_fn);     // use getPlaybackState to check state
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
}

