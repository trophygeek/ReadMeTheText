'use strict';

// import {$, logerr} from "./misc.js";

document.addEventListener('DOMContentLoaded', () => {
  {  // fixup a href links that reference this extension with the correct id.
    const fixupurls = document.querySelectorAll(`a[href^="chrome-extension:"]`);
    const extid = chrome.runtime.id;
    fixupurls.forEach((elem) => {
      const url = elem.getAttribute('href').replace('chrome.runtime.id', extid);
      elem.setAttribute('href', url);
    });
  }

});