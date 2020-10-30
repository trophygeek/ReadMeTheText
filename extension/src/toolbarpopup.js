'use strict';

import {$, CMD, logerr, trace, PLAYBACKSTATE, splitvoicename, asycChromeExt} from "./misc.js";
import {Settings, StateBus, QuotaTracker} from "./usersettings.js";
import {VOICEMODEL} from "./voiceslist.js";

class Toolbarpopup {

  currentstate = PLAYBACKSTATE.IDLE;
  playbackbtn = null;
  stopbtn = null;
  optionsbtn = null;
  clipboardbtn = null;
  qualitytype = null;
  optionsrequiredbtn = null;


  async updatePlaybackState() {
    try {
      const playbackstate = StateBus.currentState;
      trace(`updatePlaybackState  '${this.currentstate}' => '${playbackstate}'`);
      this.currentstate = playbackstate;

      switch (playbackstate) {
        case PLAYBACKSTATE.IDLE:
          this.playbackbtn.classList.remove('activate', 'animationbase', 'animationbk');
          this.playbackbtn.disabled = true;
          this.playbackbtn.setAttribute("aria-pressed", "false");
          this.playbackbtn.disabled = true;

          this.stopbtn.disabled = true;
          this.stopbtn.classList.remove('activate');
          this.stopbtn.setAttribute("aria-pressed", "false");
          break;

        case PLAYBACKSTATE.PLAYING:
          this.playbackbtn.disabled = false;
          this.playbackbtn.classList.add('activate', 'animationbase', 'animationbk');
          this.playbackbtn.setAttribute("aria-pressed", "true");

          this.stopbtn.disabled = false;
          this.stopbtn.classList.remove('activate');
          this.stopbtn.setAttribute("aria-pressed", "false");
          break;

        case PLAYBACKSTATE.PAUSED:
          this.stopbtn.disabled = false;
          this.playbackbtn.classList.remove('disabled', 'activate', 'animationbase', 'animationbk');
          this.playbackbtn.setAttribute("aria-pressed", "false");

          this.stopbtn.disabled = false;
          this.stopbtn.classList.remove('activate');
          this.stopbtn.setAttribute("aria-pressed", "false");
          break;

        case PLAYBACKSTATE.STOPPED:
          this.playbackbtn.disabled = false;
          this.playbackbtn.classList.remove('activate', 'animationbase', 'animationbk');
          this.playbackbtn.setAttribute("aria-pressed", "false");

          this.stopbtn.disabled = false;
          this.stopbtn.classList.add('activate');
          this.stopbtn.setAttribute("aria-pressed", "true");
          break;
      }
    } catch (err) {
      logerr(err, err.stack);
    }
  }

  /**
   *
   * @private
   */
  _openOptionsPage() {
    chrome.tabs.create({
      url: `chrome-extension://${chrome.runtime.id}/src/options.html`
    });
    window.close();
  }

  /**
   *
   * @param percent_complete {Number} 0.00 - 1.00
   * @param status_text {String}
   * @private
   */
  _setprogressbar(percent_complete = 0.00, status_text = '') {
    $('#progressbarcontainer').classList.remove('invisible');
    $('#progressindicator').style.width = `${percent_complete * 100}%`;
    $('#progresstext').innerHTML = status_text;
  }


  async refreshQuotaUi() {
    const voiceattr = splitvoicename(Settings.currentVoiceName);
    const totals = await QuotaTracker.get_quota_totals();

    let total = 0;
    let max = 0;

    switch (voiceattr.voiceModel) {
      case VOICEMODEL.STANDARD:
        total = totals.char_count_std;
        max = Settings.data.quota_stop_at_size_std;
        break;
      case VOICEMODEL.WAVENET:
        total = totals.char_count_wave;
        max = Settings.data.quota_stop_at_size_wave;
        break;
    }
    // todo: draw lines for warning locations?
    this.qualitytype.innerHTML = `${voiceattr.voiceModel}`;
    const totalstr = Intl.NumberFormat().format(total);
    const maxstr = Intl.NumberFormat().format(max);
    this._setprogressbar(total / max, `${totalstr} of ${maxstr}`);
  }

  /**
   *
   * @return {string}
   * @private
   */
  _getClipboard() {
    let result = '';
    const sandbox = document.getElementById('sandbox');
    sandbox.value = '';
    sandbox.hidden = false;
    sandbox.select();
    if (document.execCommand('paste')) {
      result = sandbox.value;
      trace('got value from sandbox: ', result);
    }
    sandbox.value = '';
    sandbox.hidden = true;
    return result;
  }

  async onload() {
    try {
      await Settings.init();
      await StateBus.init(this.updatePlaybackState.bind(this));
      await QuotaTracker.init();

      this.playbackbtn = $('#playbackbtn');
      this.stopbtn = $('#stopbtn');
      this.optionsbtn = $('#optionsbtn');
      this.clipboardbtn = $('#clipboardbn');
      this.qualitytype = $('#qualitytype');
      this.optionsrequiredbtn = $('#options_required');


      await this.refreshQuotaUi();
      QuotaTracker.addChangedListener(async () => {
        trace('QuotaTracker change');
        await this.refreshQuotaUi();
      });

      if (Settings.apiKey === '') {
        $('#keyrequiredmsg').classList.remove('hidden');
      }

      if (StateBus.lastError !== '') {
        $('#errmsg').classList.remove('hidden');
        $('#errmsgtext').innerText = StateBus.lastError;
      }

      this.updatePlaybackState(); // set our initial UI state

      // clicking the play button
      this.playbackbtn.addEventListener('click', (event) => {
        switch (this.currentstate) {
          case PLAYBACKSTATE.PLAYING:
            chrome.runtime.sendMessage({cmd: CMD.PAUSE});
            break;

          case PLAYBACKSTATE.STOPPED:
          case PLAYBACKSTATE.PAUSED:
            chrome.runtime.sendMessage({cmd: CMD.PLAY});
            break;
        }
      });

      this.stopbtn.addEventListener('click', (event) => {
        chrome.runtime.sendMessage({cmd: CMD.STOP});
      });

      this.optionsbtn.addEventListener('click', (event) => {
        this._openOptionsPage();
      });

      this.optionsrequiredbtn.addEventListener('click', (event) => {
        this._openOptionsPage();
      });

      this.clipboardbtn.addEventListener('click', async (event) => {
        try {
          const granted = await asycChromeExt.chromePermssionsRequest(['clipboardRead']);
          if (granted) {
            const clipboard = this._getClipboard();
            if (clipboard.length > 32000) {  // todo: add setting to control this value.
              // we need to confirm with a dialog.
            }
            chrome.runtime.sendMessage({cmd: CMD.PLAYTESTSOUND, data: clipboard});
          }
        } catch(err) {
          logerr(err, err.stack);
        }
      });

    } catch (err) {
      logerr(err, err.stack)
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const instance = new Toolbarpopup();
    await instance.onload();
  } catch (err) {
    logerr(err, err.stack);
  }
});
