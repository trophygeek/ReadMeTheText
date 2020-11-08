'use strict';
import {asycChromeExt, jsonParseSafe, logerr} from "./misc.js";
import {DEFAULT_VOICES_DATA} from "./data_static.js";
import {Settings} from "./usersettings.js";
import {TextToSpeech} from "./texttospeechclass.js";

// export const VOICEGENDER = {
//   // NO idea why these are UPPERCASED like this.
//   MALE: 'MALE',
//   FEMALE: 'FEMALE',
// };


export const VoicesList = {
  _cached_voicelist: null,
  _cached_langcode: [],

  // * Probably want to use googlevoice_voicelist_map.
  async load(reload = false) {
    try {
      /**
       * This will attempt the following in this order:
       *   1. Load cached voice data from localStorage
       *   2. Use Default data cached hardcoded in extension (probably out of dat)
       * @return {Promise<{}>}
       * @private
       */
      debugger;
      if (!reload && VoicesList._cached_voicelist !== null) {
        return;
      }

      if (reload) {
        // loads into SETTINGS._cached_voicelist
        VoicesList._cached_voicelist = await VoicesList._googlevoice_voicelist_fetch(true);
      }

      if (VoicesList._cached_voicelist === null) {   // will be empty if _googlevoice_voicelist_fetch failed too.
        // fall back to static data.
        VoicesList._cached_voicelist = await asycChromeExt.getLocalStorageData('VOICES_LIST_DATA', DEFAULT_VOICES_DATA.voices);
      }
    } catch(err) {
      logerr(err, err.stack);
    }
  },


  /**
   * Will fetch latest voice data from Google using voice api key and save it to localstorage.
   * @param reload
   * @return {Promise<{voice_name: string, lang?: string, gender?: string, event_types?: string[]}[]|null>}
   * @private
   */
  async _googlevoice_voicelist_fetch(reload = false) {
    try {
      await Settings.init();
      if (!Settings.hasApiKey) {
        return null;
      }
      const data = await TextToSpeech.apiFetchVoices(Settings.apiKey, reload);
      if (!data) {
        return null;
      }

      const data_json = jsonParseSafe(data);
      const result = data_json.voices.sort((a, b) => {
        /** data looks like this in beta
        {
        "languageCodes": ["de-DE"],
        "name": "de-DE-Wavenet-F",
        "ssmlGender": "FEMALE",
        "naturalSampleRateHertz": 24000
        },
         */
        if (a.name !== b.name) {
          return (a.name > b.name) ? 1 : -1;
        } else {
          return (a.ssmlGender > b.ssmlGender) ? 1 : -1;
        }
      });
      await asycChromeExt.setLocalStorageData('VOICES_LIST_DATA', VoicesList._cached_voicelist);
      return result;
    } catch (err) {
      logerr(err, err.stack);
      return null;
    }
  },

  // get a list of languages ONLY showing ones in the voicelist
  getLangcodeFromVoicelist: () => {
    if (VoicesList._cached_langcode.length !== 0) { // lazy cache it.
      return VoicesList._cached_langcode;
    }

    const result = {};    // map, then grab keys to de-dup.
    VoicesList._cached_voicelist.forEach((a) => {
      try {
        const countrycode = a.languageCodes[0].split('-')[0];
        result[countrycode] = 1;
      } catch(err) {
        console.log(err, err.stack);
      }
    });

    VoicesList._cached_langcode = Object.keys(result).sort();
    return VoicesList._cached_langcode;
  },
};

