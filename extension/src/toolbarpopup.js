'use strict';

import {$, CMD, logerr, trace, PLAYBACKSTATE, splitvoicename, asycChromeExt} from "./misc.js";
import {Settings, StateBus, QuotaTracker} from "./usersettings.js";
import {VOICEMODEL} from "./voiceslistconst.js";
import {htmlToFormattedText} from "./convert_html_to_text.js";

class Toolbarpopup {

  _currentstate = PLAYBACKSTATE.IDLE;

  /** @var {Element} **/
  _playbackbtn = null;
  /** @var {Element} **/
  _stopbtn = null;
  /** @var {Element} **/
  _optionsbtn = null;
  /** @var {Element} **/
  _clipboardbtn = null;
  /** @var {Element} **/
  _qualitytypelabel = null;
  /** @var {Element} **/
  optionsrequiredbtn = null;
  /** @var {Element} **/
  _keyrequiredmsg = null;
  /** @var {Element} **/
  _errmsg = null;
  /** @var {Element} **/
  _errmsgtext = null;

  /** this is called by the StateBus when our state changes **/
  async updatePlaybackState() {
    try {
      const playbackstate = StateBus.currentState;
      trace(`updatePlaybackState  '${this._currentstate}' => '${playbackstate}'`);

      this._currentstate = playbackstate;

      // states where playing is disabled
      if ([PLAYBACKSTATE.NOKEY, PLAYBACKSTATE.IDLE, PLAYBACKSTATE.ERROR].includes(playbackstate)) {
        this._playbackbtn.disabled = true;
        this._playbackbtn.classList.remove('activate', 'animationbase', 'animationbk');
        this._playbackbtn.setAttribute("aria-pressed", "false");

        this._stopbtn.disabled = true;
        this._stopbtn.classList.remove('activate');
        this._stopbtn.setAttribute("aria-pressed", "false");
      } else {
        // states where playing is enabled
        this._playbackbtn.disabled = false;
        this._playbackbtn.classList.add('activate');
        this._playbackbtn.classList.remove('animationbase', 'animationbk');
        this._playbackbtn.setAttribute("aria-pressed", "true");

        this._stopbtn.disabled = false;
        this._stopbtn.classList.remove('activate');
        this._stopbtn.setAttribute("aria-pressed", "false");
      }

      // states where play-from-clipboard are disabled/enabled
      this._clipboardbtn.disabled = ([PLAYBACKSTATE.NOKEY].includes(playbackstate));

      // show/hide alert mesages
      switch (playbackstate) {
        case PLAYBACKSTATE.PLAYING:
        case PLAYBACKSTATE.DOWNLOADING:
          this._playbackbtn.classList.add('animationbase', 'animationbk');
          break;

        case PLAYBACKSTATE.NOKEY:
          this._keyrequiredmsg.classList.remove('hidden');
          this._errmsg.classList.add('hidden');// don't show both
          break;

        case PLAYBACKSTATE.ERROR:
          trace(`toolbar.updatePlaybackState PLAYBACKSTATE.ERROR `);
          const lasterr = StateBus.getLastError();
          if (lasterr !== '') {
            this._errmsg.classList.remove('hidden');
            this._keyrequiredmsg.classList.add('hidden'); // don't show both
            this._errmsgtext.innerText = lasterr;
          }
          break;

        default:
          // hide all the message
          this._errmsg.classList.add('hidden');
          if (Settings.hasApiKey) {
            this._keyrequiredmsg.classList.add('hidden');
          }
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
    this._qualitytypelabel.innerHTML = `${voiceattr.voiceModel}`;
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
    let captured_html = '';

    // this will grab the html on the paste event.
    const capture_html_fun = (e) => {
      try {
        captured_html = e.clipboardData.getData('text/html').trim();
      } catch(err) {
        logerr(err, err.stack);
      }
    };

    document.addEventListener('paste', capture_html_fun);
    let result = '';
    const sandbox = document.getElementById('sandbox');
    sandbox.value = '';
    sandbox.hidden = false;   // unhide, while offscreen non-hidden elements can confuse aria
    sandbox.select();
    if (document.execCommand('paste')) {
      result = sandbox.value;
    }
    // remove our listener no longer needed
    document.removeEventListener('paste', capture_html_fun);
    sandbox.value = '';
    sandbox.hidden = true;

    if (captured_html !== '') {
      // this will do some reformatting so we don't lose things like the numbers in front
      // of <li> items. It will also make sure there are pauses around headers an add image captions
      result = htmlToFormattedText(captured_html, {
        linkProcess: (href, linkText) => linkText,
        imgProcess: (imSrc, imAlt) => `  Image with caption "${imAlt}" .   `,   // todo: localize
        headingStyle: 'breakline',
        uIndentionChar: ' ',
        oIndentionChar: ' ',
        keepNbsps: false,
        removeExtraWhitespace: false,
      });

      // For speaking we want convert the linefeeds to spaces for spaking pauses.\w\n works, but we want more pauses
      // after :
      result = result.replace(/([^.!?])\n/g, "$1. \n");
    }

    return result;
  }

  _checkIfEmptyKey() {
    if (!Settings.hasApiKey) {
      this._keyrequiredmsg.classList.remove('hidden');
    } else {
      this._keyrequiredmsg.classList.add('hidden');
    }
  }

  async onload() {
    try {
      await Settings.init();
      await StateBus.init();
      StateBus.setOnChange(this.updatePlaybackState.bind(this));
      await QuotaTracker.init();

      this._playbackbtn = $('#playbackbtn');
      this._stopbtn = $('#stopbtn');
      this._optionsbtn = $('#optionsbtn');
      this._clipboardbtn = $('#clipboardbn');
      this._qualitytypelabel = $('#qualitytypelabel');
      this._optionsrequiredbtn = $('#options_required');
      this._keyrequiredmsg = $('#keyrequiredmsg');
      this._errmsg = $('#errmsg');
      this._errmsgtext = $('#errmsgtext');


      Settings.addChangedListener(this._checkIfEmptyKey.bind(this));
      this._checkIfEmptyKey();

      await this.refreshQuotaUi();

      QuotaTracker.addChangedListener(async () => {
        trace('QuotaTracker change');
        await this.refreshQuotaUi();
      });

      await this.updatePlaybackState(); // set our initial UI state

      // clicking the play button
      this._playbackbtn.addEventListener('click', () => {
        switch (this._currentstate) {
          case PLAYBACKSTATE.PLAYING:
            chrome.runtime.sendMessage({cmd: CMD.PAUSE});
            break;

          case PLAYBACKSTATE.STOPPED:
          case PLAYBACKSTATE.PAUSED:
            chrome.runtime.sendMessage({cmd: CMD.PLAY});
            break;
        }
      });

      this._stopbtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({cmd: CMD.STOP});
      });

      this._optionsbtn.addEventListener('click', () => {
        this._openOptionsPage();
      });

      this._optionsrequiredbtn.addEventListener('click', () => {
        this._openOptionsPage();
      });

      // button does a confirm step. It uses data-confirm to track it's stage.
      let savedbuttontext = '';
      this._clipboardbtn.addEventListener('click', async () => {
        try {
          const granted = await asycChromeExt.chromePermissionsRequest(['clipboardRead']);
          if (granted) {
            let confirmed = true;
            const clipboard = this._getClipboard();

            if (clipboard.length > 5000) {  // todo: add setting to control this value. add check for goign over threshold
              const confirmeddata = this._clipboardbtn.getAttribute('data-confirm-stage') || '0';
              if (confirmeddata === '0') {
                // swap the button to be a confirm.
                const confirmtxt = this._clipboardbtn.getAttribute('data-confirm-message');
                savedbuttontext = this._clipboardbtn.innerHTML;
                this._clipboardbtn.innerHTML = confirmtxt.replace('${size}',
                    Intl.NumberFormat().format(clipboard.length));
                this._clipboardbtn.classList.add('inverse');

                this._clipboardbtn.setAttribute('data-confirm-stage', '1');
                confirmed = false;
              } else if (confirmeddata === '1') {
                // so, it's a confirm click
                this._clipboardbtn.innerHTML = savedbuttontext;
                this._clipboardbtn.classList.remove('inverse');
                savedbuttontext = '';
              }
            }
            if (confirmed) {
              chrome.runtime.sendMessage({cmd: CMD.PLAYTESTSOUND, data: clipboard});
              this._clipboardbtn.setAttribute('data-confirm-stage', '0');
            }
          }
        } catch (err) {
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
