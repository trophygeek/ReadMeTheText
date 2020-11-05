'use strict';

// based on https://github.com/EDMdesigner/textversionjs/blob/master/src/textversion.js

const populateChar = (ch, amount) => {
  let result = "";
  for (let i = 0; i < amount; i += 1) {
    result += ch;
  }
  return result;
};

const striphtml = (html) => {
  // NOTE: Calling this requires "style-src 'self' 'unsafe-inline';" be added to content_security_policy
  // is it worth it?
  let doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || "";
}

export function htmlToFormattedText(htmlText, styleConfig) {
  // define default styleConfig
  let linkProcess = null;
  let imgProcess = null;
  let headingStyle = "breakline"; // hashify, breakline, underline
  let listStyle = "indention"; // indention, linebreak
  let uIndentionChar = " ";
  let listIndentionTabs = 3;
  let oIndentionChar = " ";
  let keepNbsps = true;

  // or accept user defined config
  if (!!styleConfig) {
    if (typeof styleConfig.linkProcess === "function") {
      linkProcess = styleConfig.linkProcess;
    }
    if (typeof styleConfig.imgProcess === "function") {
      imgProcess = styleConfig.imgProcess;
    }
    if (!!styleConfig.headingStyle) {
      headingStyle = styleConfig.headingStyle;
    }
    if (!!styleConfig.listStyle) {
      listStyle = styleConfig.listStyle;
    }
    if (!!styleConfig.uIndentionChar) {
      uIndentionChar = styleConfig.uIndentionChar;
    }
    if (!!styleConfig.listIndentionTabs) {
      listIndentionTabs = styleConfig.listIndentionTabs;
    }
    if (!!styleConfig.oIndentionChar) {
      oIndentionChar = styleConfig.oIndentionChar;
    }
    if (!!styleConfig.keepNbsps) {
      keepNbsps = styleConfig.keepNbsps;
    }
  }

  const uIndention = populateChar(uIndentionChar, listIndentionTabs);

  // removel all \n linebreaks
  let tmp = String(htmlText).replace(/\n|\r/g, " ");

  // remove everything before and after <body> tags including the tag itself
  const bodyEndMatch = tmp.match(/<\/body>/i);
  if (bodyEndMatch) {
    tmp = tmp.substring(0, bodyEndMatch.index);
  }
  const bodyStartMatch = tmp.match(/<body[^>]*>/i);
  if (bodyStartMatch) {
    tmp = tmp.substring(bodyStartMatch.index + bodyStartMatch[0].length, tmp.length);
  }

  // remove inbody scripts and styles
  tmp = tmp.replace(/<(script|style)( [^>]*)*>((?!<\/\1( [^>]*)*>).)*<\/\1>/gi, "");

  // remove all tags except that are being handled separately
  tmp = tmp.replace(/<(\/)?((?!h[1-6]( [^>]*)*>)(?!img( [^>]*)*>)(?!a( [^>]*)*>)(?!ul( [^>]*)*>)(?!ol( [^>]*)*>)(?!li( [^>]*)*>)(?!p( [^>]*)*>)(?!div( [^>]*)*>)(?!td( [^>]*)*>)(?!br( [^>]*)*>)[^>\/])[^<>]*>/gi, "");

  // remove or replace images - replacement texts with <> tags will be removed also, if not intentional, try to use other notation
  tmp = tmp.replace(/<img([^>]*)>/gi, function (str, imAttrs) {
    let imSrc = "";
    let imAlt = "";
    const imSrcResult = (/src="([^"]*)"/i).exec(imAttrs);
    const imAltResult = (/alt="([^"]*)"/i).exec(imAttrs);
    if (imSrcResult !== null) {
      imSrc = imSrcResult[1];
    }
    if (imAltResult !== null) {
      imAlt = imAltResult[1];
    }
    if (typeof (imgProcess) === "function") {
      return imgProcess(imSrc, imAlt);
    }
    if (imAlt === "") {
      return "![image] (" + imSrc + ")";
    }
    return "![" + imAlt + "] (" + imSrc + ")";
  });

  function createListReplaceCb() {
    return function (match, listType, listAttributes, listBody) {
      let liIndex = 0;
      if (listAttributes && /start="([0-9]+)"/i.test(listAttributes)) {
        liIndex = (/start="([0-9]+)"/i.exec(listAttributes)[1]) - 1;
      }
      const plainListItem = "<p>" + listBody.replace(/<li[^>]*>(((?!<li[^>]*>)(?!<\/li>).)*)<\/li>/gi, function (str, listItem) {
        let actSubIndex = 0;
        return listItem.replace(/(^|(<br \/>))(?!<p>)/gi, function () {
          if (listType === "o" && actSubIndex === 0) {
            liIndex += 1;
            actSubIndex += 1;
            return "<br />" + liIndex + populateChar(oIndentionChar, listIndentionTabs - (String(liIndex).length));
          }
          return "<br />" + uIndention;
        });
      }) + "</p>";
      return plainListItem;
    };
  }

  // handle lists
  if (listStyle === "linebreak") {
    tmp = tmp.replace(/<\/?ul[^>]*>|<\/?ol[^>]*>|<\/?li[^>]*>/gi, "\n");
  } else if (listStyle === "indention") {
    while (/<(o|u)l[^>]*>(.*)<\/\1l>/gi.test(tmp)) {
      tmp = tmp.replace(/<(o|u)l([^>]*)>(((?!<(o|u)l[^>]*>)(?!<\/(o|u)l>).)*)<\/\1l>/gi, createListReplaceCb());
    }
  }

  // handle headings
  if (headingStyle === "linebreak") {
    tmp = tmp.replace(/<h([1-6])[^>]*>([^<]*)<\/h\1>/gi, "\n$2\n");
  } else if (headingStyle === "underline") {
    tmp = tmp.replace(/<h1[^>]*>(((?!<\/h1>).)*)<\/h1>/gi, function (str, p1) {
      return "\n&nbsp;\n" + p1 + "\n" + populateChar("=", p1.length) + "\n&nbsp;\n";
    });
    tmp = tmp.replace(/<h2[^>]*>(((?!<\/h2>).)*)<\/h2>/gi, function (str, p1) {
      return "\n&nbsp;\n" + p1 + "\n" + populateChar("-", p1.length) + "\n&nbsp;\n";
    });
    tmp = tmp.replace(/<h([3-6])[^>]*>(((?!<\/h\1>).)*)<\/h\1>/gi, function (str, p1, p2) {
      return "\n&nbsp;\n" + p2 + "\n&nbsp;\n";
    });
  } else if (headingStyle === "hashify") {
    tmp = tmp.replace(/<h([1-6])[^>]*>([^<]*)<\/h\1>/gi, function (str, p1, p2) {
      return "\n&nbsp;\n" + populateChar("#", p1) + " " + p2 + "\n&nbsp;\n";
    });
  }

  // replace <br>s, <td>s, <divs> and <p>s with linebreaks
  tmp = tmp.replace(/<br( [^>]*)*>|<p( [^>]*)*>|<\/p( [^>]*)*>|<div( [^>]*)*>|<\/div( [^>]*)*>|<td( [^>]*)*>|<\/td( [^>]*)*>/gi, "\n");

  // replace <a href>b<a> links with b (href) or as described in the linkProcess function
  tmp = tmp.replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a[^>]*>/gi, function (str, href, linkText) {
    if (typeof linkProcess === "function") {
      return linkProcess(href, linkText);
    }
    return " [" + linkText + "] (" + href + ") ";
  });

  // remove whitespace from empty lines excluding nbsp
  tmp = tmp.replace(/\n[ \t\f]*/gi, "\n");

  // remove duplicated empty lines
  tmp = tmp.replace(/\n\n+/gi, "\n");

  if (keepNbsps) {
    // remove duplicated spaces including non braking spaces
    tmp = tmp.replace(/( |\t)+/gi, " ");
    tmp = tmp.replace(/&nbsp;/gi, " ");
  } else {
    // remove duplicated spaces including non braking spaces
    tmp = tmp.replace(/( |&nbsp;|\t)+/gi, " ");
  }

  // // remove line starter spaces
  // tmp = tmp.replace(/\n +/gi, "\n");
  //
  // // remove content starter spaces
  // tmp = tmp.replace(/^ +/gi, "");
  //
  // // remove first empty line
  // while (tmp.indexOf("\n") === 0) {
  //   tmp = tmp.substring(1);
  // }
  //
  // // put a new line at the end
  // if (tmp.length === 0 || tmp.lastIndexOf("\n") !== tmp.length - 1) {
  //   tmp += "\n";
  // }

  // we may have missed some tags, strip them
  tmp = striphtml(tmp);

  return tmp;
}
