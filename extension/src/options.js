'use strict';

import {
  CHAR_COUNT_STD_FREE_MAX,
  CHAR_COUNT_WAVE_FREE_MAX,
  DEFAULT_VOICE_NAME,
  QuotaTracker,
  Settings
} from "./usersettings.js";
import {
  $,
  CMD,
  dateDiffDisplay,
  equalsIgnoringCase,
  getFirstMatchForLang,
  languageStrings,
  logerr,
  splitvoicename,
  getVoicenameList,
} from "./misc.js";
import {VOICEMODEL, VoicesList} from "./voiceslist.js";

try {
  //  <optgroup label="Sports"> could be used
  const clearSelectMenuElement = (selectmenu) => {
    // snapshot, the remove in reverse order. Required because we're iterating over what we're removing.
    const len = selectmenu.options.length;
    for (let ii = len; ii; ii--) {
      selectmenu.removeChild(selectmenu.options[ii - 1]);
    }
  };

  /**
   // Range Label
   .range-slider__value {
      display: inline-block;
      position: relative;
      width: $range-label-width;
      color: $shade-0;
      line-height: 20px;
      text-align: center;
      border-radius: 3px;
      background: $range-label-color;
      padding: 5px 10px;
      margin-left: 8px;

      &:after {
        position: absolute;
        top: 8px;
        left: -7px;
        width: 0;
        height: 0;
        border-top: 7px solid transparent;
        border-right: 7px solid $range-label-color;
        border-bottom: 7px solid transparent;
        content: '';
      }
    }

   <div class="range-slider">
   <input id="maxvalue" class="range-slider__range" type="range" value="100" min="0" max="500">
   <span class="range-slider__value" for=">0</span>
   </div>

   */

  let debounceSave_t = 0;

  function debounceSave(wait = 250) {
    clearTimeout(debounceSave_t);
    debounceSave_t = setTimeout(async () => {
      await Settings.save();
    }, wait);
  }

  const rangeSlider = (elemid) => {
    try {
      const refresh_func = (currentTarget) => {
        $(`span.range-slider__value[for='${currentTarget.id}']`).innerText = currentTarget.value;
      }

      $(elemid).addEventListener('input', (evt) => refresh_func(evt.currentTarget));

      refresh_func($(elemid));  // initial refresh call.
    } catch (err) {
      logerr(err, err.stack)
    }
  };

  const toggleShowHidePasswordField = () => {
    const elem = $('#apiKey');
    const hiddenpasswordicon = $('#hiddenpasswordicon');
    const shownpasswordicon = $('#shownpasswordicon');
    if (elem.type === 'text') {
      elem.type = 'password';
      hiddenpasswordicon.classList.remove('hidden');
      shownpasswordicon.classList.add('hidden');
    } else {
      elem.type = 'text';
      hiddenpasswordicon.classList.add('hidden');
      shownpasswordicon.classList.remove('hidden');
    }
  }
  /**
   * Interesting approach:
   * 1. Select the language from the first menu, this scans the list of possible
   *    voicenames and returns the first match.
   * 2. Based on the selected voicename, all the other menus are adjust to match
   *    (available coutries and available Model types (wave vs basic) and available voices)
   *
   * This works for the other menus AS WELL. Make any change, and the first matching voice name is selected
   * and the menus are adjusted.
   * @param current_voice
   * @return {Promise<void>}
   */
  const refreshMenusBasedOnVoice = async (current_voice = DEFAULT_VOICE_NAME) => {
    try {
      const {lang, languageCode, voiceModel, variant} = splitvoicename(current_voice);
      const voicenames = await getVoicenameList([lang]);

      // voicemodel menu
      const _UpdateVoiceModelMenu_fn = () => {
        const MENU = {
          [VOICEMODEL.WAVENET]: 'Wavenet (better quality more expensive)',
          [VOICEMODEL.STANDARD]: 'Basic (less expensive)',
        };

        // in theory some langs may only support a subset of types.
        const available_types = [];
        Object.entries(voicenames).forEach(([key, entry]) => {
          const {voiceModel} = splitvoicename(key);
          if (available_types.includes(voiceModel)) {
            return; // already added it.
          }
          available_types.push(voiceModel);
        });

        const selectmenu = $('#voiceModel');
        // clear the current
        clearSelectMenuElement(selectmenu);

        Object.entries(MENU).forEach(([key, entry]) => {
          if (available_types.includes(key)) {
            const newelem = document.createElement('OPTION');
            newelem.value = key;
            newelem.innerHTML = entry;
            // is this our default?
            newelem.selected = (key === voiceModel);
            selectmenu.appendChild(newelem);
          }
        });
      };

      const _UpdateVoiceNameMenu_fn = () => {
        const selectmenu = $('#voiceids');
        clearSelectMenuElement(selectmenu);
        Object.entries(voicenames).forEach(([key, entry]) => {
          try {
            // we need to filter on the model type.
            if (equalsIgnoringCase(entry.voiceModel, voiceModel)) {
              const newelem = document.createElement('OPTION');
              newelem.value = entry.name; // note: the key includes the gender... which we don't want.
              newelem.innerText = entry.label;
              newelem.selected = (entry.name === current_voice);
              selectmenu.appendChild(newelem);
            }
          } catch (err) {
            logerr(err, err.stack);
          }
        });
      };


      _UpdateVoiceModelMenu_fn();
      _UpdateVoiceNameMenu_fn();
    } catch (err) {
      logerr(err, err.stack);
    }
  };


  const updateKeyRequiredMsg = () => {
    if (Settings.apiKey === '') {
      $('#keyrequiredmsg').classList.remove('hidden');
    } else {
      $('#keyrequiredmsg').classList.add('hidden');
    }
  }

  // OnLoad
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await Settings.init();
      await QuotaTracker.init();
      await VoicesList.load();

      const {voiceModel, variant, languageCode, lang} = splitvoicename(Settings.currentVoiceName);
      const current_lang = languageCode;

      {  // apikey
        const apikeyelem = $('#apiKey');
        apikeyelem.value = Settings.apiKey;
        updateKeyRequiredMsg();

        // change event
        apikeyelem.addEventListener('change', async (evt) => {
          Settings.apiKey = apikeyelem.value.trim();
          updateKeyRequiredMsg();
          debounceSave();
        });

        $('#shownpasswordicon').addEventListener('click', () => {
          toggleShowHidePasswordField();
        });
        $('#hiddenpasswordicon').addEventListener('click', () => {
          toggleShowHidePasswordField();
        });
      }

      { // pitch
        const pitchelem = $('#pitch');
        // set initial value
        pitchelem.value = Settings.data.pitch;

        pitchelem.addEventListener('change', async (evt) => {
          // save
          Settings.data.pitch = parseFloat(pitchelem.value);
          debounceSave();
        });
        // ui to display value next to slider
        rangeSlider('#pitch');
      }

      { // speaking rate
        const speakingrateelm = $('#speakingRate');
        // set initial value
        speakingrateelm.value = Settings.data.speakingRate;
        speakingrateelm.addEventListener('change', async (evt) => {
          // save
          Settings.data.speakingRate = parseFloat(speakingrateelm.value);
          debounceSave();
        });
        // ui to display value next to slider
        rangeSlider('#speakingRate');
      }

      {  // audio encoding
        const dropdown = $('#audioEncoding');
        for (let ii = 0; ii < dropdown.length; ii++) {
          dropdown[ii].selected = (dropdown[ii].value === Settings.data.audioEncoding);
        }
        dropdown.addEventListener('change', (evt) => {
          Settings.data.audioEncoding = evt.target.value;
          debounceSave();
        });
      }

      {  // effectsProfileId
        const dropdown = $('#effectsProfileId');
        for (let ii = 0; ii < dropdown.length; ii++) {
          dropdown[ii].selected = (dropdown[ii].value === Settings.data.effectsProfileId);
        }
        dropdown.addEventListener('change', (evt) => {
          Settings.data.effectsProfileId = evt.target.value;
          debounceSave();
        });
      }

      const langselect = $('#langselect');
      const voicemodelselect = $('#voiceModel');
//      const voicegenderselect = $('#voicegender');
      const voiceids = $('#voiceids');
      const fullvoicelist = await getVoicenameList();

      { // language popup dropdown select
        const lang_map = languageStrings.getlangonlymap();  // [en:"English"]
        Object.keys(lang_map).forEach((key) => {
          const newelem = document.createElement('OPTION');
          newelem.value = key;
          newelem.innerHTML = `${lang_map[key]} (${key})`;
          // is this our default?
          newelem.selected = current_lang.startsWith(key);
          langselect.appendChild(newelem);
        });
      }

      // initialize each dropdown menu
      await refreshMenusBasedOnVoice(Settings.currentVoiceName);

      // watch for changes.
      // It seems counter intuitive, but
      // 1. Any menu change triggers a voice change
      // 2. We pick the first voice from that change
      // 3. We match up all the attribute menus to match that voice.

      const updateMenusFn = async (target) => {
        try {
          const lang = $('#langselect').value;
          const voiceModel = $('#voiceModel').value;
          Settings.currentVoiceName = getFirstMatchForLang(lang, voiceModel);
          debounceSave();

          // now that we picked a new name, make the menus match
          await refreshMenusBasedOnVoice(Settings.currentVoiceName);
        } catch (err) {
          logerr(err, err.stack);
        }
      };

      // Language Menu
      langselect.addEventListener('change', async ({target}) => {await updateMenusFn(target);});

      // voice model changed
      voicemodelselect.addEventListener('change', async ({target}) => {await updateMenusFn(target);});

      // voice names itself
      voiceids.addEventListener('change', async ({target}) => {
        Settings.currentVoiceName = target.value;
        debounceSave();
      });

      { // testtext texarea and playsound button
        const playtestsound = $('#playtestsound');
        const testtextelem = $('#textTextArea');
        testtextelem.innerText = Settings.data.testText;  // initial setting.

        testtextelem.addEventListener('change', (event) => {
          const newtext = event.currentTarget.value;
          Settings.data.testText = newtext.trim();
          playtestsound.disabled = (Settings.data.testText === '' || Settings.apiKey === '');
          debounceSave();
        });

        playtestsound.disabled = (Settings.data.testText === '' || Settings.apiKey === '');
        playtestsound.addEventListener('click', () => {
          chrome.runtime.sendMessage({cmd: CMD.PLAYTESTSOUND, data: testtextelem.value });
        });
      }

      // $('#savesound').addEventListener('click', () => {
      //   chrome.runtime.sendMessage({cmd: CMD.SAVESOUND});
      // });

      {
        // quotas
        const quota_count_std_elem = $('#quotaValueStd');
        const quota_count_wave_elem = $('#quotaValueWave');
        const quota_date_elem = $('#quotaLastReset');
        const quota_reset_btn = $('#quotaResetBtn')

        const updatefn = async () => {
          const totals = await QuotaTracker.get_quota_totals();

          const percent_std = Math.round(totals.char_count_std / CHAR_COUNT_STD_FREE_MAX * 100, 4);
          const percent_wave = Math.round(totals.char_count_wave / CHAR_COUNT_WAVE_FREE_MAX * 100, 4);
          const char_count_std = Intl.NumberFormat().format(totals.char_count_std);
          const char_count_wave = Intl.NumberFormat().format(totals.char_count_wave);
          const char_count_std_free_max = Intl.NumberFormat().format(CHAR_COUNT_STD_FREE_MAX);
          const char_count_wave_free_max = Intl.NumberFormat().format(CHAR_COUNT_WAVE_FREE_MAX);

          quota_count_std_elem.innerText = `${char_count_std}  of ${char_count_std_free_max} (${percent_std}%)`;
          quota_count_wave_elem.innerText = `${char_count_wave} of ${char_count_wave_free_max} (${percent_wave}%)`;

          const resetdate = new Date(Settings.data.quota_last_reset_date_str);
          const datestr = resetdate.toLocaleString();
          const datadiffstr = dateDiffDisplay(resetdate);
          quota_date_elem.innerText = `${datestr} (${datadiffstr})`;
        };

        await updatefn();  // refresh now now

        await QuotaTracker.addChangedListener(updatefn);  // watch for changes.
        await Settings.addChangedListener(updatefn);

        quotaResetBtn.addEventListener('click', async () => {
          await QuotaTracker.quotatime_reset();
          await updatefn();
        });
      }

    } catch (err) {
      logerr(err, err.stack);
    }

  });

} catch (err) {
  logerr(err, err.stack)
}