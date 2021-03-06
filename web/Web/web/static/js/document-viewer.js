/* docView.js, (c) 2016 - 2020 Mustafa Abualsaud - http://www.mustafa-s.com */

var docView = function() {

	var self = this;
	this.version = '0.1.0';

	this.options = {
    csrfmiddlewaretoken: null, // required
	  judgingSourceName: "CAL",

	  // urls
    getPrevDocumentsJudgedURL: null, // required if showing prev reviewed docs
    getDocumentsToJudgeURL: null, // required if caching enabled
    getDocumentIDsToJudgeURL: null, // required
    sendDocumentJudgmentURL: null, // required
    getDocumentURL: null, // required

    // options
    hideFullDocument: false,
    hideSnippet: false,
    allowShowFullDocumentButton: false,
    allowJudgingKeyboardShortcuts: false, // if true, requires importing Mousetrap lib
    allowDocumentCaching: true, // if true, requires LRU cache library (https://github.com/tusharf5/runtime-memcache)
    cacheStoreMax: 50,
    showTopTerms: true,
    fetchPreviouslyJudgedDocsOnInit: false,
    singleDocumentMode: false,
    searchMode: false,

    // Selectors
    docViewSelector: "#docView",
    documentIDSelector: "#docViewDocID",
    documentIndicatorSelector: "#docViewDocIndicator",
    documentTitleSelector: "#docViewDocTitle",
    documentMetaSelector: "#docViewDocMeta",
    documentMessageSelector: "#docViewDocMessage",
    documentWrapperSelector: "#docViewDocWrapper",
    documentSnippetSelector: "#docViewDocSnippet",
    documentShowFullDocumentButtonSelector: "#docViewDocShowFullDocumentButton",
    documentBodySelector: "#docViewDocBody",
    documentCloseButtonSelector: "#docViewDocCloseButton",
    documentHRelButtonSelector: ".docViewDocHRelButton",
    documentRelButtonSelector: ".docViewDocRelButton",
    documentNonRelButtonSelector: ".docViewDocNonRelButton",
    previouslyReviewedListSelector: ".previouslyReviewedList",
    previouslyReviewedListSpinnerSelector: ".previouslyReviewedListSpinner",
    searchItemSelector: ".searchItemSelector",
    documentModalSelector: "#documentModal",

    // Colors
    highlyRelevantColor: "#84c273",
    relevantColor: "#c6fab8",
    nonrelevantColor: "#a5a5a5",
    otherColor: "#DEE2E6",
    primaryColor: "#000",
    secondaryColor: "#5C7080",
    projectPrimaryColor: "#F7533D",
    dangerColor: "#DB3737",

    // CSS
    primaryTitleFont: "document-title-font-family",
    secondaryTitleFont: "docView-default-font-family",

    // others
    prevReviewedDocumentItemClass: "prev-reviewed-doc-item"
  };

  /*************
   * VARIABLES *
   *************/
  this.currentDocID = null;
  this.viewStack = [];
  this.previouslyJudgedDocs = {};
  this.previouslyJudgedDocsStack = [];
  this.documentCacheStore = null;


  this._init = function() {
    console.log("Initiating document view.");
    // create cache store
    if (this.options.allowDocumentCaching){
      // uses RMStore from https://github.com/tusharf5/runtime-memcache.
      this.documentCacheStore = RMStore({"cacheStoreMax": this.options.cacheStoreMax});
    }

    return true;
  };
};

docView.prototype = {
  /**
	 * Validate and merge user settings with default settings
	 *
	 * @param  {object} settings User settings
	 * @return {bool} False if settings contains error
	 */
	/* jshint maxstatements:false */
	init: function(settings) {
    "use strict";

    var parent = this;

    var options = parent.options = mergeRecursive(parent.options, settings);

    // Fatal errors
    // Stop script execution on error
    validateSelector(options.docViewSelector, false, "docViewSelector");
    validateSelector(options.documentIDSelector, false, "documentIDSelector");
    validateSelector(options.documentIndicatorSelector, true, "documentIndicatorSelector");
    validateSelector(options.documentTitleSelector, false, "documentTitleSelector");
    validateSelector(options.documentMetaSelector, true, "documentMetaSelector");
    validateSelector(options.documentMessageSelector, false, "documentMessageSelector");
    validateSelector(options.documentWrapperSelector, false, "documentWrapperSelector");
    validateSelector(options.previouslyReviewedListSelector, true, "previouslyReviewedListSelector");
    validateSelector(options.previouslyReviewedListSpinnerSelector, true, "previouslyReviewedListSpinnerSelector");
    validateSelector(options.documentSnippetSelector, true, "documentSnippetSelector");
    validateSelector(options.documentShowFullDocumentButtonSelector, true, "documentShowFullDocumentButtonSelector");
    validateSelector(options.documentBodySelector, false, "documentIDSelector");
    validateSelector(options.documentCloseButtonSelector, true, "documentCloseButtonSelector");
    validateSelector(options.searchItemSelector, true, "searchItemSelector");
    validateSelector(options.documentModalSelector, true, "documentModalSelector");

    // Don't touch these settings
    var s = ["beforeDocumentLoad", "afterDocumentLoad", "afterDocumentViewUpdateCompleted", "afterLoadDocumentsToJudge", "afterDocumentJudge"];

    for (var k in s) {
      if (settings.hasOwnProperty(s[k])) {
        options[s[k]] = settings[s[k]];
      }
    }

    // start linking selectors
    $(document).ready(function(){
      $(options.documentHRelButtonSelector).on("click", function(){sendJudgment(2, options.searchMode? closeDocumentModal : refreshDocumentView)});
      $(options.documentRelButtonSelector).on("click", function(){sendJudgment(1, options.searchMode? closeDocumentModal : refreshDocumentView)});
      $(options.documentNonRelButtonSelector).on("click", function(){sendJudgment(0, options.searchMode? closeDocumentModal : refreshDocumentView)});
      $(options.documentCloseButtonSelector).on("click", function(){closePreviouslyReviewedDocument()});

      $('body').on("click", options.searchItemSelector, function(){showDocument($(this).data("doc-id").toString())});
    });

    if (!options.singleDocumentMode && !options.searchMode){
        // start process of updating document view
        showLoading();
        getDocumentsToJudge(refreshDocumentView);
    }else{
      showNoDocumentIsSelected();
    }

    if (options.fetchPreviouslyJudgedDocsOnInit) {
        populatePrevReviewedDocuments();
    }


    /**
     * Validate that a queryString is valid
     *
     * @param  {Element|string|bool} selector   The queryString to test
     * @param  {bool}  canBeFalse  Whether false is an accepted and valid value
     * @param  {string} name    Name of the tested selector
     * @throws {Error}        If the selector is not valid
     * @return {bool}        True if the selector is a valid queryString
     */
    function validateSelector(selector, canBeFalse, name) {
      if (((canBeFalse && selector === false) || selector instanceof Element || typeof selector === "string") && selector !== "") {
        return true;
      }
      throw new Error("The " + name + " is not valid");
    }

    /*************
     * FUNCTIONS *
     *************/

    /**
     * Calls server to request document information and shows it once received.
     */
    function showDocument(docid) {
      parent.beforeDocumentLoad(docid);
      if (options.allowDocumentCaching){
        // check if it exists in cache
        if (parent.documentCacheStore.get(docid) !== null){
          _showDocumentCallback(docid, parent.documentCacheStore.get(docid));
          return;
        }
      }

      fetchDocument(docid,  _showDocumentCallback);
    }

    /**
     * Views top of the view stack document
     */
    function refreshDocumentView() {
      // Show loading
      showLoading();
      if (parent.viewStack.length === 0){
        if (options.singleDocumentMode || options.searchMode){
          showNoDocumentIsSelected();
        }else{
          showNoMoreDocuments();
        }
        $(options.docViewSelector).trigger("updated");
        return;
      }
      let docid = parent.viewStack[0];
      parent.viewStack.shift(); // remove it from viewStack
      // Show document
      showDocument(docid);
      $(options.docViewSelector).trigger("updated");
    }

    /**
     * Views a previously judged document
     * @param docid
     */
    function viewPrevious(docid){

      const currentDocid = parent.currentDocID;
      // If its the same document currently shown, don't do anything
      if (currentDocid === docid){
        return;
      }
      // If the current doc is already reviewed, remove it and dont show it unless requested
      if (currentDocid in parent.previouslyJudgedDocs) {
        parent.viewStack.shift();
      }else{
        // add non-reviewed document back to stack
        parent.viewStack.unshift(currentDocid);
      }
      // Add the prev reviewed document to the beginning of the stack
      parent.viewStack.unshift(docid);

      refreshDocumentView();
    }

    function closePreviouslyReviewedDocument() {
      // If the current doc is already reviewed, remove it and dont show it unless requested
      if (parent.currentDocID in parent.previouslyJudgedDocs) {
        if (parent.viewStack.length !== 0 && parent.viewStack[0] === parent.currentDocID){
          parent.viewStack.shift();
        }
      }
      refreshDocumentView();
    }

    function checkIfDocumentPreviouslyJudged(docid) {
      let color = null;
      if (docid in parent.previouslyJudgedDocs){
        color = relToColor(parent.previouslyJudgedDocs[docid]);
        if (!(options.singleDocumentMode || options.searchMode)){
          showCloseButton();
        }
      } else{
        hideCloseButton();
        color = options.otherColor;
      }
      updateDocumentIndicator(relToTitle(parent.previouslyJudgedDocs[docid]), color);
    }

    function closeDocumentModal() {
      $(options.documentModalSelector).modal('hide');
    }

    /****************
     * VIEW CHANGES *
     ***************/

    function clearDocumentView() {
      updateDocumentIndicator("",options.otherColor);
      updateDocID(null);
      updateTitle("");
      updateMessage("");
      updateMeta("");
      unhighlight();
      updateSnippet("");
      updateBody("");
      showWrapperContent();
    }

    function showLoading(){
      updateTitle("Loading...", {"font": options.secondaryTitleFont, "color": options.projectPrimaryColor});
      //updateMessage("");
      updateDocID(null);
      updateSnippet("Loading...", {"font": options.secondaryTitleFont, "color": options.secondaryColor});
      updateBody("Loading...", {"font": options.secondaryTitleFont, "color": options.secondaryColor});
      hideCloseButton();
    }

    function showNoDocumentIsSelected() {
      updateTitle("Please select a document to show", {"font": options.secondaryTitleFont, "color": options.projectPrimaryColor});
      updateMessage("No document has been selected. Please click on a document to view its content.");
      updateDocID(null);
      hideCloseButton();
    }

    function showNoMoreDocuments() {
      updateTitle("Please wait..", {"font": options.secondaryTitleFont, "color": options.projectPrimaryColor});
      updateMessage("There are no more documents to judge. Please wait or try refreshing the page.");
      updateDocID(null);
      hideCloseButton();
    }

    function showMaxJudgmentReached() {
      updateTitle("No more documents", {"font": options.secondaryTitleFont, "color": options.projectPrimaryColor});
      updateMessage("There are no more documents to judge. Please wait or try refreshing the page.");
      updateDocID(null);
      hideCloseButton();
      // disable judgments
    }


    function showError(err_msg){
      updateTitle("Error...", {"font": options.secondaryTitleFont, "color": options.dangerColor});
      updateMessage(err_msg, {"font": options.secondaryTitleFont, "color": options.dangerColor});
      updateDocID(null);
      hideCloseButton();
    }

    function updateTitle(content, styles) {
      const elm = $(options.documentTitleSelector);
      elm.html(content).removeClass();
      updateStyles(elm, styles);
    }

    function updateMeta(content) {
      const elm = $(options.documentMetaSelector);
      elm.html(content);
    }

    function updateBody(content, styles) {
      const elm = $(options.documentBodySelector);
      elm.html(content).removeClass();
      updateStyles(elm, styles);
    }

    function updateSnippet(content, styles) {
      const elm = $(options.documentSnippetSelector);
      elm.html(content).removeClass();
      updateStyles(elm, styles);
    }

    function updateDocumentIndicator(title, color) {
      if (color !== null){
        $(options.documentIndicatorSelector).css("border-color", color);
        $(options.documentIndicatorSelector).attr('title', title);
      }
    }

    function updateMessage(content, styles) {
      const elm = $(options.documentMessageSelector);
      elm.html(content).removeClass();
      hideWrapperContent();
      updateStyles(elm, styles);
    }

    function updateDocID(docid){
      parent.currentDocID = docid;
      const elm = $(options.documentIDSelector);
      if (docid){
        elm.html(docid);
        $(options.docViewSelector).data('doc-id', docid);
      }else{
        elm.html("");
        $(options.docViewSelector).data('doc-id', '');
      }
    }

    function hideWrapperContent() {
      $(options.documentWrapperSelector).addClass("d-none");
    }

    function showWrapperContent() {
      $(options.documentWrapperSelector).removeClass("d-none");
    }

    function hideCloseButton(){
      $(options.documentCloseButtonSelector).addClass("d-none");
    }

    function showCloseButton() {
      $(options.documentCloseButtonSelector).removeClass("d-none");
    }

    function updateOrCreatePreviouslyReviewedListItem(docid, title, rel){
      const div_elm = generate_prev_reviewed_doc_div_elm(docid, title, rel);
      // Check if docid is already in prev reviewed docs stack, if so, pop it
      const stack_index = parent.previouslyJudgedDocsStack.indexOf(docid);
      if (stack_index !== -1){
        parent.previouslyJudgedDocsStack.splice(stack_index, 1);
        // remove the div associated with the docid
        $("."+options.prevReviewedDocumentItemClass).each(function() {
          if ($(this).data("doc-id").toString() === docid){
            $(this).remove();
          }
        });
      }
      // link on click
      div_elm.on("click", function(){viewPrevious($(this).data("doc-id").toString())});

      // add to top of the list view/stack
      $(options.previouslyReviewedListSelector).prepend(div_elm);
      parent.previouslyJudgedDocsStack.push(docid);


    }

    function highlightTerm(term, score) {
      const highlight_options = {
        element: "top-term",
        accuracy: "complementary",
        className: "top-term",
        each: function (elm) {
          $(elm).css('background', convertHex(options.projectPrimaryColor, score)); // TODO: have fixed color
          $(elm).data("markjs", "").attr("data-markjs", "");
        }
      }

      $(options.documentTitleSelector).mark(term, highlight_options);
      $(options.documentBodySelector).mark(term, highlight_options);
      $(options.documentSnippetSelector).mark(term, highlight_options);
    }

    function unhighlight() {
      $(options.documentTitleSelector).unmark();
      $(options.documentBodySelector).unmark();
      $(options.documentSnippetSelector).unmark();
    }


    /****************
     * SERVER CALLS *
     ***************/

    /**
     * Calls server to request documents to judge.
     */
    function getDocumentsToJudge(callback) {
      const url = options.allowDocumentCaching ? options.getDocumentsToJudgeURL : options.getDocumentIDsToJudgeURL;
      $.ajax({
          url: url,
          method: 'GET',
          success: function (result) {
            updateViewStack(result);
            if (typeof callback === "function") {
              callback();
            }
          },
          error: function (err_msg){
            showError(JSON.stringify(err_msg));
          }
      });
    }

    function populatePrevReviewedDocuments(callback) {
      const url = options.getPrevDocumentsJudgedURL;
      $.ajax({
          url: url,
          method: 'GET',
          success: function (result) {
            $(options.previouslyReviewedListSpinnerSelector).addClass("d-none");
            parent.previouslyJudgedDocsStack = [];
            for (let i = 0; i < result.length; i++){
              let item = result[result.length - 1 - i];
              parent.previouslyJudgedDocs[item["doc_id"]] = item["relevance"];
              updateOrCreatePreviouslyReviewedListItem(item["doc_id"], item["doc_title"], item["relevance"]);
            }
            if (typeof callback === "function") {
              callback();
            }
          },
          error: function (err_msg){
            $(options.previouslyReviewedListSpinnerSelector).addClass("d-none");
            $(options.previouslyReviewedListSelector).prepend(JSON.stringify(err_msg));
          }
      });
    }

    /**
     * Calls server to request document information.
     */
    function fetchDocument(docid, callback) {
      $.ajax({
            url: getDocumentURL(docid),
            type: 'GET',
            dataType: 'json', // added data type
            success: function(res) {
              // AFTER SUCCESSFUL RETRIEVAL OF DOCUMENT INFO
              callback(docid, res[0]);
        }
      });
    }

    function sendJudgment(rel, callback) {
      if (!(options.singleDocumentMode || options.searchMode)){
        window.scrollTo(0, 0);
      }
      const docid = parent.currentDocID;
      if (docid === null){
        return;
      }

      parent.previouslyJudgedDocs[docid] = rel;
      const currentTitle = getCurrentDocTitle();
      const currentSnippet = getCurrentDocSnippet();
      updateOrCreatePreviouslyReviewedListItem(docid, currentTitle, rel);

      if (!options.singleDocumentMode && !options.searchMode){
        clearDocumentView();
      }else{
        updateDocumentIndicator(relToTitle(rel), relToColor(rel));
      }
      // add document to previously judged map
      // load next in line document
      if (typeof callback === "function") {
        callback();
      }

      var now = + new Date();
      var data = {
          'doc_id': docid,
          'doc_title': currentTitle,
          'doc_CAL_snippet': currentSnippet,
          'doc_search_snippet': "",
          'relevance': rel,
          'source': options.judgingSourceName,
          'client_time': now,
          'search_query': null,
          'ctrl_f_terms_input': $("#search_content").val(),
          'csrfmiddlewaretoken': options.csrfmiddlewaretoken,
          'page_title': document.title,

          // history item
          'historyItem': {
            "timestamp": now,
            "source": options.judgingSourceName,
            "judged": true,
            "relevance": rel,
          },
      };

      $.ajax({
          url: options.sendDocumentJudgmentURL,
          method: 'POST',
          data: JSON.stringify(data),
          success: function (result) {
              if (!options.singleDocumentMode && !options.searchMode){
                updateViewStack(result["next_docs"]);
              }
              if(result['is_max_judged_reached']){
                  showMaxJudgmentReached();
                  //disableJudgments();
                  return;
              }

              if (parent.currentDocID === null){
                if (typeof callback === "function") {
                  callback();
                }
              }
              parent.afterDocumentJudge(docid, rel);
          },
          error: function (result){
            if (parent.currentDocID === null){
              showError(result);
            }
            console.error("Something went wrong. ");
          },
          statusCode: {
              502: function (xhr) {
                if (parent.currentDocID === null){
                  showError(xhr.responseText);
                }
                console.log("Something went wrong. Timeout error." +
                      "Judgment may have not been recorded.", xhr.responseText);
              }
          }
      });

    }

    /*************
     * CALLBACKS *
     *************/

    function _showDocumentCallback(docid, data) {
      /**
       * Callback to show document in document view once server returns document information.
       */
      clearDocumentView();

      updateDocID(docid);

      if (typeof data.title === "string"){
        updateTitle(data.title, {"font": options.primaryTitleFont, "color": options.primaryColor});
      }
      if (typeof data.content === "string"){
        updateBody(data.content, {"color": options.primaryColor});
      }
      if (typeof data.date === "string"){
        updateMeta(data.date);
      }
      if (typeof data.snippet === "string"){
        updateSnippet(data.snippet, {"color": options.primaryColor});
      }
      if (options.showTopTerms && isDict(data.top_terms)){
        for (let term in data.top_terms){
          const score = data.top_terms[term]
          if (term.endsWith("i")){ // this is because we have stemmed top terms
            term = term.slice(0, -1) + 'y';
          }
          highlightTerm(term, score);
        }
      }

      if (data.rel && typeof data.rel === "number"){
        const color = relToColor(data.rel);
        checkIfDocumentPreviouslyJudged(docid);
        updateDocumentIndicator(relToTitle(data.rel), color);
      }else{
        checkIfDocumentPreviouslyJudged(docid);
      }

      parent.afterDocumentLoad(docid);
    }


    /**************
     * EXCEPTIONS *
     **************/

    /**
     * Unknown search engine.
     * @param message
     * @constructor
     */
    // function UnknownSearchEngine(message) {
    //   this.name = 'UnknownSearchEngine';
    //   this.message = message || 'Could not determine search engine.';
    //   this.stack = (new Error()).stack;
    // }
    // UnknownSearchEngine.prototype = Object.create(Error.prototype);
    // UnknownSearchEngine.prototype.constructor = UnknownSearchEngine;


    /////////////////////////////////////////////////////

    /***********
     * HELPERS *
     ***********/

    /**
     * Updates the view stack from results returned by server
     */
    function updateViewStack(result) {
      let docids = [];
      if (!options.allowDocumentCaching){
        for (let i = 0; i < result.length; i++){
          // make sure stack doesn't include previously judged documents or current doc
          if (!(result[i] in parent.previouslyJudgedDocs) && result[i] !== parent.currentDocID ){
            docids.push(result[i]);
          }
        }
      }else{
        for (let i = 0; i < result.length; i++){
          const doc = result[i];
          parent.documentCacheStore.set(doc.doc_id, doc);
          // make sure stack doesn't include previously judged documents
          if (!(doc.doc_id in parent.previouslyJudgedDocs) && doc.doc_id !== parent.currentDocID){
            docids.push(doc.doc_id);
          }
        }
      }
      parent.viewStack = docids;
    }

    function generate_prev_reviewed_doc_div_elm(docid, title, rel) {
      const rel_color = relToColor(rel);
      return $(`
        <a href="#" class="d-flex mb-1 text-muted ${options.prevReviewedDocumentItemClass}" style="min-height: 1rem;" data-doc-id="${docid}">
            <div class="align-self-center align-self-stretch p-1" style="border-width: 0.15rem!important; border-style: none none none solid; border-color: ${rel_color};"></div>
            <div class="align-self-center text-truncate">
                <div class="docView-default-font-family text-truncate">${title}</div>
            </div>
        </a>
      `);
    }

    function getCurrentDocTitle() {
      if (parent.currentDocID !== null){
        return $(options.documentTitleSelector).text()
      }
      return null;
    }

    function getCurrentDocSnippet() {
      if (parent.currentDocID !== null){
        return $(options.documentSnippetSelector).text()
      }
      return null;
    }

    function updateStyles(selector, styles) {
      if (styles !== undefined){
        if (styles.font !== undefined){
          selector.addClass(styles.font);
        }
        if (styles.color !== undefined){
          selector.css("color", styles.color);
        }
      }

    }

    function getDocumentURL(docid) {
      return options.getDocumentURL + docid;
    }

    function isDict(v) {
      return typeof v==='object' && v!==null && !(v instanceof Array) && !(v instanceof Date);
    }

    function convertHex(hex, opacity){
      hex = hex.replace('#','');
      const r = parseInt(hex.substring(0,2), 16);
      const g = parseInt(hex.substring(2,4), 16);
      const b = parseInt(hex.substring(4,6), 16);
      return 'rgba('+r+','+g+','+b+','+opacity+')';
    }

    /**
     * Given a numerical value of the relevance, return the appropriate color.
     * */
    function relToColor(rel) {
      if (rel === 2) {
        return options.highlyRelevantColor;
      }else if (rel === 1) {
        return options.relevantColor;
      } else if (rel === 0) {
        return options.nonrelevantColor;
      }
      return options.otherColor;
    }

    /**
     * Given a numerical value of the relevance, return the appropriate title.
     * */
    function relToTitle(rel) {
      if (rel === 2) {
        return "Highly Relevant";
      }else if (rel === 1) {
        return "Relevant";
      } else if (rel === 0) {
        return "NonRelevant";
      }
      return "";
    }


    return this._init();
  },


  // =========================================================================//
	// EVENTS CALLBACK															                            //
	// =========================================================================//

	/**
	 * Helper method for triggering event callback
	 *
	 * @param  string	eventName       Name of the event to trigger
	 * @param  array	successArgs     List of argument to pass to the callback
	 * @param  boolean  skip			Whether to skip the event triggering
	 * @return mixed	True when the triggering was skipped, false on error, else the callback function
	 */
	triggerEvent: function(eventName, successArgs, skip) {
		"use strict";

		if ((arguments.length === 3 && skip) || this.options[eventName] === null) {
			return true;
		}

		if (typeof this.options[eventName] === "function") {
			if (typeof successArgs === "function") {
				successArgs = successArgs();
			}
			return this.options[eventName].apply(this, successArgs);
		} else {
			console.log("Provided callback for " + eventName + " is not a function.");
			return false;
		}
	},

  beforeDocumentLoad: function(docid) {
		"use strict";
		return this.triggerEvent("beforeDocumentLoad", [docid]);
	},

  afterDocumentLoad: function(docid) {
		"use strict";
		return this.triggerEvent("afterDocumentLoad", [docid]);
	},

  afterDocumentJudge: function(docid, rel) {
		"use strict";
		return this.triggerEvent("afterDocumentJudge", [docid, rel]);
	},

};

/**
 * #source http://stackoverflow.com/a/383245/805649
 */
function mergeRecursive(obj1, obj2) {
	"use strict";

	/*jshint forin:false */
	for (var p in obj2) {
		try {
			// Property in destination object set; update its value.
			if (obj2[p].constructor === Object) {
				obj1[p] = mergeRecursive(obj1[p], obj2[p]);
			} else {
				obj1[p] = obj2[p];
			}
		} catch(e) {
			// Property in destination object not set; create it and set its value.
			obj1[p] = obj2[p];
		}
	}

	return obj1;
}

/**
 * Loader
 */
if (typeof define === "function" && define.amd) {
	define([], function() {
		"use strict";

		return docView;
	});
} else if (typeof module === "object" && module.exports) {
	module.exports = docView;
} else {
	window.docView = docView;
}
