// shared by background, popup and options page. Should have not external dependencies
import {VOICEMODEL, VoicesList} from "./voiceslist.js";
import {Settings} from "./usersettings.js";
import {LANGUAGESTRINGSDATA} from "./data_static.js";

const ERR_BREAK_ENABLED = true;
const TRACE_ENABLED = true;

// todo: abstract out keys so there can be multiple ones, each with their own quota tracking
export const EXT_NAME = 'gTextToSpeechExt';  // todo: come up with actual name

/* eslint-disable: no-console no-undef no-octal-escape no-octal */
export const logerr = (...args) => {
  if (TRACE_ENABLED === false) {
    return;
  }
  console.error(`${EXT_NAME} `, ...args);
  if (ERR_BREAK_ENABLED) {
    debugger;
  }
};

export const trace = (...args) => {
  if (TRACE_ENABLED) {
    // blue color , no break
    console.log(`${EXT_NAME} `, ...args);
  }
};

export const CMD = {
  PAUSE: 'PAUSE',
  STOP: 'STOP',
  PLAY: 'PLAY',
  PLAYTESTSOUND: 'PLAYTESTSOUND',
  SAVESOUND: 'SAVESOUND',
};

export const PLAYBACKSTATE = {
  IDLE: 'IDLE',      // no sound loaded
  DOWNLOADING: 'DOWNLOADING',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',  // sound loaded but not playing (reset to start of track)
  ERROR: 'ERROR',     // something went wrong.
};


/**
 * Kind of like jQuery's $ but only returns 1 element.
 * @param id
 * @return {*}
 */
export function $(id) {
  return document.querySelector(id);
}


/**
 * @param val {string}
 * @return {string}
 */
export function capitalize(val) {
  return val.charAt(0).toUpperCase() + val.slice(1).toLowerCase()
}

export function equalsIgnoringCase(text, other) {
  return text.localeCompare(other, undefined, {sensitivity: 'base'}) === 0;
}

export function arrayIncludesNoCase(arr_haystack, needle) {
  for (let ii = 0; ii < arr_haystack.length; ii++) {  // for lets us return from loop
    const target = arr_haystack[ii] || '';
    if (equalsIgnoringCase(target, needle)) {
      return true;
    }
  }
  return false;
}

/**
 * de-DE-Wavenet-F
 * @param name string
 * @return {{lang: string, languageCode: string, voiceModel: string, variant: string}}
 * {
 *   lang: 'de;
 *   langCode: 'de-DE'
 *   voiceModel: 'Standard'
 *   variant: 'F'
 */
export function splitvoicename(name) {
  if (typeof name !== "string" || name === '') {
    logerr('invalid name encountered');
    throw('invalid name encountered');
  }
  const parts = name.split('-');
  return {
    lang: parts[0].toLowerCase(),
    languageCode: `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`,
    voiceModel: capitalize(parts[2]),  // Wavenet vs Standard
    variant: parts[3].toUpperCase(),
  }
}

/**
 * json.parse() has this annoying behavior where it throws if the data is an empty string.
 * avoid that by passing in a default value that can be used. Improves readability
 *
 * @param jsonstr {string}
 * @param default_val {*}
 * @param reviver_fn {function}
 * @return {*}
 */
export function jsonParseSafe(jsonstr = '', default_val, reviver_fn = null) {
  try {
    if (!jsonstr && jsonstr.trim() === '') {
      return default_val;
    }
    if (reviver_fn) {
      return JSON.parse(jsonstr, reviver_fn);
    } else {
      return JSON.parse(jsonstr);
    }
  } catch (err) {
    logerr(err, `'${jsonstr}'`, err.stack);
    return default_val;
  }
}


// <editor-fold defaultstate="collapsed" desc="-- languageStrings  --">
export const languageStrings = {
  /**
   * Map is "lang-country" => "name"
   * e.g.
   *      {
   *        en-US: 'English (United States)',
   *        en-GB: 'English (Great Britain)'
   *        ...
   *        }
   * @param keys_arr {String[]}  Array of lang-country to include e.g. ['en-US','en-GB']
   * @return {{}}
   */
  getvaluesmap(keys_arr = []) {
    const result = {};
    const langcodefilter = VoicesList.getLangcodeFromVoicelist();
    LANGUAGESTRINGSDATA.forEach((a) => {
      try {
        // empty keys_arr means return all.
        if ((keys_arr.length === 0) || (!keys_arr.includes(a.id))) {
          // now ignore ones NOT in the voicelist
          const langcode = a.id.split('-')[0];
          if (langcodefilter.includes(langcode)) {
            result[a.id] = a.name;
          }
        }
      } catch (err) {
        logerr(err, err.stack);
      }
    });
    return result;
  },

  /**
   * Returns only the first part (en: English
   * @return {{}}
   */
  getlangonlymap() {
    const langcodefilter = VoicesList.getLangcodeFromVoicelist();
    const result = {};
    LANGUAGESTRINGSDATA.forEach((a) => {
      const lang = a.id.split('-')[0];
      if (!result[lang]) { // not already found
        if (langcodefilter.includes(lang)) {
          result[lang] = a.name.split('(')[0].trim();
        }
      }
    });
    return result;
  },

};
// </editor-fold>

/*
  * @param restrict_lang {string[]} e.g. ['en','fr']
  * @param restrict_gen {string[]}  e.g. ['wavenet', 'standard']
  * @param restrict_model {string[]} e.g ['male','female,'neutral']
  * @return {Promise<{'string:{{label: {string}, gender: {string}, languageCode: {string}, voiceModel: {string}, name: {string} }}>}
  */
export async function getVoicenameList(restrict_lang = [], restrict_model = [], restrict_gender = []) {
  try {
    const LANG_MAP = languageStrings.getvaluesmap();
    const result = {};

    VoicesList._cached_voicelist.forEach((a) => {
      // restrictions
      const {lang, languageCode, voiceModel, variant} = splitvoicename(a.name);
      const gender = a.ssmlGender;
      const genderlabel = capitalize(gender);
      const voiceid = `${a.name}-${gender}`;
      const langname = LANG_MAP[languageCode];

      if (restrict_lang.length > 0 && !arrayIncludesNoCase(restrict_lang, lang)) {
        return; // skipping
      }
      if (restrict_model.length > 0 && !arrayIncludesNoCase(restrict_model, voiceModel)) {
        return; // skipping
      }
      if (restrict_gender.length > 0 && !arrayIncludesNoCase(restrict_gender, gender)) {
        return; // skipping
      }

      const voicemodel_str = (equalsIgnoringCase(voiceModel, VOICEMODEL.WAVENET) ? 'Wave' : 'Std');

      result[voiceid] = {
        label: `${langname} Variant-${variant} (${genderlabel}-${voicemodel_str})`,
        gender,
        languageCode,
        voiceModel,
        name: a.name,  // original name
      }
    });
    return result;
  } catch (err) {
    logerr(err, err.stack);
    return [];
  }
}

/**
 * assumes the VoicesList._cached_voicelist is sorted.
 * @param newlang {string}
 * @return {string}
 */
export function getFirstMatchForLang(newlang, voicemodel = VOICEMODEL.WAVENET) {
  if (newlang === '') {
    logerr(`getFirstMatchForLang given empty language string '${newlang}'`);
    return '';
  }
  let firstmatch = ''
  for (let ii = 0; ii < VoicesList._cached_voicelist.length; ii++) {
    const name = VoicesList._cached_voicelist[ii].name;
    if (name.startsWith(newlang)) {
      if (firstmatch === '') {
        firstmatch = name;
      }
      if (name.indexOf(voicemodel) !== -1) {
        return name;
      }
    }
  }
  if (firstmatch === '') {
    logerr(`getFirstMatchForLang didn't find match for '${newlang}'`);
  }
  return firstmatch;
}

// export function getFirstMatchForModel(newlang, model) {
//   for (let ii = 0; ii < VoicesList._cached_voicelist.length; ii++) {
//     const voicename = VoicesList._cached_voicelist[ii].name;
//     const {lang, languageCode, voiceModel, variant} = splitvoicename(voicename);
//     if (newlang === lang && model === voiceModel) {
//       return voicename;
//     }
//   }
//   logerr(`language not found '${newlang}'`);
//   return '';
// }

/**
 * Not going to pull in all of Moments just to do this.
 * @param oldDate {Date}
 * @param newDate {Date}
 * @return {string}
 */
export function dateDiffDisplay(oldDate, newDate = new Date()) {
  const SEC_PER_DAY = 86400;
  const SEC_PER_HOUR = 3600;
  const SEC_PER_MIN = 60;

  const msecDiff = (newDate - oldDate);    // (new Date('1/2/2020') - new Date('1/1/2020')) => 86400000
  let secdiff = Math.round(msecDiff / 1000);

  const days = Math.floor(secdiff / SEC_PER_DAY);
  secdiff -= (days * SEC_PER_DAY);

  const hrs = Math.floor(secdiff / (SEC_PER_HOUR));
  secdiff -= (hrs * SEC_PER_HOUR);

  const mins = Math.floor((secdiff / SEC_PER_MIN) % SEC_PER_MIN);
  secdiff -= (mins * SEC_PER_MIN);
  const secs = secdiff % SEC_PER_MIN;

  const parts = [];
  days ? parts.push(`${days}d`) : '';
  hrs ? parts.push(`${hrs}h`) : '';
  mins ? parts.push(`${mins}m`) : '';
  secs ? parts.push(`${secs}s`) : '';

  // if we have days, we don't need to show seconds-level resolution
  days ? parts.pop() : '';
  return parts.join(' ');
}

export const asycChromeExt = {
  /**
   * async await chrome.storage.local.get
   * @param key {string}
   * @param defaultdata {{}}
   * @return {Promise<{}>}
   */
  getLocalStorageData: (key = '', defaultdata = null) => {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get({[key]: defaultdata}, function (items) {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          reject(chrome.runtime.lastError.message);
        } else {
          if (items.hasOwnProperty(key)) {
            resolve(items[key]);
          } else {
            logerr('getLocalStorageData default data did not load');
            resolve(defaultdata);
          }
        }
      });
    });
  },

  /**
   * Technically, the chrome api allows setting mulitple key/value pairs,
   *          but we don't use it that way.
   * @param key {string}
   * @param data {any}
   * @return {Promise<void>}
   */
  setLocalStorageData: (key = '', data) => {
    return new Promise(function (resolve, reject) {
      const data_pairs = {[key]: data};
      chrome.storage.local.set(data_pairs, function () {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          reject(chrome.runtime.lastError.message);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * async await chrome.storage.sync.get
   * @param key {string}
   * @param defaultdata {{}}
   * @return {Promise<{}>}
   */
  getRemoteStorageData: (key = '', defaultdata = null) => {
    return new Promise(function (resolve, reject) {
      chrome.storage.sync.get({[key]: defaultdata}, function (items) {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          reject(chrome.runtime.lastError.message);
        } else {
          if (items.hasOwnProperty(key)) {
            resolve(items[key]);
          } else {
            // in theory this is not needed because we pass the default value to the call?
            logerr('getLocalStorageData default data did not load');
            resolve(defaultdata);
          }
        }
      });
    });
  },

  /**
   *
   * @param keysmap [{String:{objec}}]
   * @return {Promise<{}>}
   */
  getRemoteStorageDataBulk: (keysmap) => {
    return new Promise(function (resolve, reject) {
      chrome.storage.sync.get(keysmap, function (items) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message);
        } else {
          resolve(items);
        }
      });
    });
  },

  /**
   * Technically, the chrome api allows setting mulitple key/value pairs,
   *          but we don't use it that way.
   * @param key {string}
   * @param data {any}
   * @return {Promise<void>}
   */
  setRemoteStorageData: (key = '', data) => {
    return new Promise(function (resolve, reject) {
      const data_pairs = {[key]: data};
      chrome.storage.sync.set(data_pairs, function (items) {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          reject(chrome.runtime.lastError.message);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   *  export function sendMessage(extensionId: string, message: any, options: MessageOptions, responseCallback?: (response: any) => void): void;*
   * @param extensionId {string}
   * @param message {*}
   * @param options {MessageOptions}
   */
  chromeRuntimeSendMessage(extensionId, message, options) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
          extensionId, message, options,
          function (response) {
            if (chrome.runtime.lastError) {
              console.error(chrome.runtime.lastError.message);
              reject(chrome.runtime.lastError.message);
            } else {
              resolve(response);
            }
          });
    });
  },

  /**
   *
   * @param permissions_array {string[]}
   * @return {Promise<boolean>}
   */
  chromePermssionsRequest(permissions_array) {
    return new Promise(function (resolve, reject) {
      chrome.permissions.request(
          {permissions: permissions_array},
          function (granted) {
            if (chrome.runtime.lastError) {
              console.error(chrome.runtime.lastError.message);
              reject(chrome.runtime.lastError.message);
            } else {
              resolve(granted);
            }
          });
    });
  },
};


/**
 * Source: https://jameshfisher.com/2017/10/30/web-cryptography-api-hello-world/
 * @param str {string}
 * @return {Promise<string>}
 */
export async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder("utf-8").encode(str));
  return Array.prototype.map.call(new Uint8Array(buf), x => (('00' + x.toString(16)).slice(-2))).join('');
}

/**
 * Source: https://jameshfisher.com/2017/10/30/web-cryptography-api-hello-world/
 * @param str {string}
 * @return {Promise<string>}
 */
export async function sha1(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder("utf-8").encode(str));
  return Array.prototype.map.call(new Uint8Array(buf), x => (('00' + x.toString(16)).slice(-2))).join('');
}


/**
 * @return {string}
 */
export function generateUniqueId() {
  const rnd = crypto.getRandomValues(new Uint8Array(8));
  return Array.prototype.map.call(rnd, x => (('00' + x.toString(16)).slice(-2))).join('');
}

// /**
//  *
//  * @param min {number}
//  * @param max {number}
//  * @return {number}
//  */
// export function getRandomInt(min, max) {
//   return Math.floor(Math.random() * (max - min + 1)) + min;
// }

/**
 * The background thread creates an instance of this and the popup menu and toolbar menu
 * use that instance to play voice.
 * The Options page uses a "test only" instance for verifying the api key.
 */
export class classGoogleTextToSpeech {
  /** @var {AudioContext} **/
  _audioCtx = null;
  /** @var {AudioBufferSourceNode} **/
  _trackSource = null;
  _pausedoffset = 0;
  _audioBuffer = null;
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
    return _lasterr;
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
      const response = await fetch(url).catch((err) => {
        logerr(err, err.stack);  // todo handle fetch error
        return false;
      });
      if (!response.ok) {
        return false;
      }
      return await response.text();
    } catch (err) {
      logerr(err, err.stack);
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
   * @param voicename string
   * @param audioConfig {audioEncoding:{string}, effectsProfileId:{string}, pitch: {string}, speakingRate: {string}}
   * @param voice {languageCode:{string}, name:{string}}
   * @return {Promise<{success: boolean, charactercount: number}>}
   */
  async apiFetchAudio(text_to_speak,
                      apikey = Settings.apiKey,
                      voicename = Settings.currentVoiceName,
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
      });

      // todo: In general, Google Cloud will return a HTTP 429 error code if you're using
      //  HTTP/REST to access the service, or ResourceExhausted

      if (!response.ok) {
        const err = await response.text();
        this.setPlaybackState(PLAYBACKSTATE.ERROR);
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
   * @return {Promise<void>}
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
    } catch (err) {
      logerr(err, err.stack);
      this._lasterr = err.toString();
      this.setPlaybackState(PLAYBACKSTATE.ERROR);
    }
  }

  async pauseTrack() {
    if (this._audioCtx && this._audioCtx.state !== 'suspended') {
      await this._audioCtx.suspend();
    }
    this.setPlaybackState(PLAYBACKSTATE.PAUSED);
  }

  async unpauseTrack() {
    if (this._audioCtx && this._audioCtx.state === 'suspended') {  // "closed" | "running" | "suspended";
      // await this._audioCtx.resume();
      this.setPlaybackState(PLAYBACKSTATE.PLAYING);
      await this.playTrack(true);
    }
  }

  async stopTrack() {
    if (![PLAYBACKSTATE.IDLE, PLAYBACKSTATE.STOPPED].includes(this.getPlaybackState())) {
      this.setPlaybackState(PLAYBACKSTATE.STOPPED);
    }
    if (this._audioCtx && this._audioCtx.state !== 'closed') {
      await this._audioCtx.close();
    }
    this._pausedoffset = 0;
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

