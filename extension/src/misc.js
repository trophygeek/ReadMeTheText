'use strict';
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
  console.log(`${EXT_NAME} `, ...args);   // console.error() goes into chrome's error log
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
  NOKEY: 'NOKEY',      // no sound loaded
  IDLE: 'IDLE',      // no sound loaded
  DOWNLOADING: 'DOWNLOADING',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',  // sound loaded but not playing (reset to start of track)
  ERROR: 'ERROR',     // something went wrong.
};


/**
 * Kind of like jQuery's $ but only returns 1 element.
 * @param selector
 * @return {Element}
 */
export function $(selector) {
  return document.querySelector(selector);
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
 * @param voicemodel {string}
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

