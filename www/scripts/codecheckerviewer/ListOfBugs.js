// -------------------------------------------------------------------------
//                     The CodeChecker Infrastructure
//   This file is distributed under the University of Illinois Open Source
//   License. See LICENSE.TXT for details.
// -------------------------------------------------------------------------

define([
  'dojo/_base/declare',
  'dojo/dom-construct',
  'dojo/Deferred',
  'dojo/data/ObjectStore',
  'dojo/store/api/Store',
  'dojo/store/util/QueryResults',
  'dojo/topic',
  'dijit/layout/BorderContainer',
  'dijit/layout/TabContainer',
  'dijit/Tooltip',
  'dojox/grid/DataGrid',
  'codechecker/BugViewer',
  'codechecker/BugFilterView',
  'codechecker/RunHistory',
  'codechecker/hashHelper',
  'codechecker/util'],
function (declare, dom, Deferred, ObjectStore, Store, QueryResults, topic,
  BorderContainer, TabContainer, Tooltip, DataGrid, BugViewer, BugFilterView,
  RunHistory, hashHelper, util) {

  function getRunData(runId) {
    var runFilter = new CC_OBJECTS.RunFilter();
    runFilter.ids = [runId];
    runFilter.exactMatch = true;

    var runData = CC_SERVICE.getRunData(runFilter);
    return runData.length ? runData[0] : null;
  }

  function initByUrl(grid) {
    var state = hashHelper.getValues();

    switch (state.subtab) {
      case undefined:
        topic.publish('subtab/bugOverview');
        return;
      case 'runHistory':
        topic.publish('subtab/runHistory');
        return;
      default:
        topic.publish('openFile',
          state.report !== undefined ? state.report : null,
          state.run !== undefined ? getRunData(parseInt(state.run)) : null,
          state.reportHash !== undefined ? state.reportHash : null,
          grid);
    }
  }

  var filterHook = function(filters, isDiff) {
    var length = 0;

    Object.keys(filters).map(function (key) {
      if (filters[key])
        length += filters[key].length;
    })

    topic.publish("hooks/FilteringChanged" + (isDiff ? "Diff" : ""), length);
  };

  var createRunResultFilterParameter = function (reportFilters) {
    var cmpData = null;
    var runIds = null;
    if (reportFilters.run)
      runIds = reportFilters.run;
    else if (reportFilters.baseline || reportFilters.newcheck) {
      runIds = reportFilters.baseline;

      if (reportFilters.newcheck) {
        cmpData = new CC_OBJECTS.CompareData();
        cmpData.runIds = reportFilters.newcheck;
        cmpData.diffType = reportFilters.difftype
          ? reportFilters.difftype
          : CC_OBJECTS.DiffType.NEW;
      }
    }

    return {
      runIds  : runIds,
      cmpData : cmpData
    };
  };

  var BugStore = declare(Store, {
    constructor : function () {
      this.sortType = [];
    },

    get : function (id) {
      var deferred = new Deferred();

      CC_SERVICE.getReport(id, function (reportData) {
        if (typeof reportData === 'string')
          deferred.reject('Failed to get report ' + id + ': ' + reportData);
        else
          deferred.resolve(reportData);
      });

      return deferred;
    },

    getIdentity : function (reportData) {
      return reportData.reportId;
    },

    query : function (query, options) {
      var that = this;
      var deferred = new Deferred();

      var runResultParam = createRunResultFilterParameter(query.reportFilters);

      CC_SERVICE.getRunResults(
        runResultParam.runIds,
        CC_OBJECTS.MAX_QUERY_SIZE,
        options.start,
        options.sort ? options.sort.map(this._toSortMode) : null,
        query.reportFilters,
        runResultParam.cmpData,
        function (reportDataList) {
          if (reportDataList instanceof RequestFailed)
            deferred.reject('Failed to get reports: ' + reportDataList.message);
          else {
            deferred.resolve(that._formatItems(reportDataList));
            filterHook(query.reportFilters, false);
          }
        });

      deferred.total = CC_SERVICE.getRunResultCount(runResultParam.runIds,
        query.reportFilters, runResultParam.cmpData);

      return deferred;
    },

    _formatItems : function (reportDataList) {
      reportDataList.forEach(function (reportData) {
        if (reportData.line)
          reportData.checkedFile = reportData.checkedFile +
            ' @ Line ' + reportData.line;

        //--- Review status ---//

        var review = reportData.reviewData;
        reportData.reviewStatus = review.status;
        reportData.reviewComment = review.author && review.comment
          ? review.comment
          : review.author ? '-' : '';
      });

      return reportDataList;
    },

    _toSortMode : function (sort) {
      var sortMode = new CC_OBJECTS.SortMode();

      sortMode.type
        = sort.attribute === 'checkedFile'
        ? CC_OBJECTS.SortType.FILENAME
        : sort.attribute === 'checkerId'
        ? CC_OBJECTS.SortType.CHECKER_NAME
        : sort.attribute === 'detectionStatus'
        ? CC_OBJECTS.SortType.DETECTION_STATUS
        : sort.attribute === 'reviewStatus'
        ? CC_OBJECTS.SortType.REVIEW_STATUS
        : CC_OBJECTS.SortType.SEVERITY;
      sortMode.ord
        = sort.descending
        ? CC_OBJECTS.Order.DESC
        : CC_OBJECTS.Order.ASC;

      return sortMode;
    }
  });

  function severityFormatter(severity) {
    // When loaded from URL then report data is originally a number.
    // When loaded by clicking on a table row, then severity is already
    // changed to its string representation.
    if (typeof severity === 'number')
      severity = util.severityFromCodeToString(severity);

    var title = severity.charAt(0).toUpperCase() + severity.slice(1);
    return '<span title="' + title  + '" class="customIcon icon-severity-'
      + severity + '"></span>';
  }

  function detectionStatusFormatter(detectionStatus) {
    if (detectionStatus !== null) {
      var status = util.detectionStatusFromCodeToString(detectionStatus);

      return '<span title="' + status  + '" class="customIcon detection-status-'
        + status.toLowerCase() + '"></span>';
    }

    return 'N/A';
  }

  function reviewStatusFormatter(reviewStatus) {
    var className = util.reviewStatusCssClass(reviewStatus);
    var status =
      util.reviewStatusFromCodeToString(reviewStatus);

    return '<span title="' + status
      + '" class="customIcon ' + className + '"></span>';
  }

  function checkerMessageFormatter(msg) {
    return msg !== null ? msg : 'N/A';
  }

  var ListOfBugsGrid = declare(DataGrid, {
    constructor : function () {
      var width = (100 / 5).toString() + '%';

      this.structure = [
        { name : 'File', field : 'checkedFile', cellClasses : 'link compact', width : '100%' },
        { name : 'Message', field : 'checkerMsg', width : '100%', formatter : checkerMessageFormatter },
        { name : 'Checker name', field : 'checkerId', cellClasses : 'link', width : '50%' },
        { name : 'Severity', field : 'severity', cellClasses : 'severity', width : '15%', formatter : severityFormatter },
        { name : 'Review status', field : 'reviewStatus', cellClasses : 'review-status', width : '15%', formatter : reviewStatusFormatter },
        { name : 'Review comment', cellClasses : 'review-comment-message compact', field : 'reviewComment', width : '50%' },
        { name : 'Detection status', field : 'detectionStatus', cellClasses : 'detection-status', width : '15%', formatter : detectionStatusFormatter }
      ];

      this.focused = true;
      this.selectable = true;
      this.keepSelection = true;
      this.store = new ObjectStore({ objectStore : new BugStore() });
      this.escapeHTMLInData = false;
      this.selectionMode = 'single';
      this._lastSelectedRow = 0;
    },

    refreshGrid : function (reportFilters) {
      this.setQuery({ reportFilters : reportFilters });
    },

    canSort : function (inSortInfo) {
      var cell = this.getCell(Math.abs(inSortInfo) - 1);

      return cell.field === 'checkedFile' ||
             cell.field === 'checkerId'   ||
             cell.field === 'severity'    ||
             cell.field === 'reviewStatus' ||
             cell.field === 'detectionStatus';
    },

    scrollToLastSelected : function () {
      this.scrollToRow(this._lastSelectedRow);
    },

    onRowClick : function (evt) {
      var item = this.getItem(evt.rowIndex);

      this._lastSelectedRow = evt.rowIndex;

      switch (evt.cell.field) {
        case 'checkedFile':
          topic.publish('openFile', item, this.runData, item.bugHash, this);
          break;

        case 'checkerId':
          topic.publish('showDocumentation', item.checkerId);
          break;
      }
    },

    onRowMouseOver : function (evt) {
      if (!evt.cell)
        return;

      var item = this.getItem(evt.rowIndex);
      switch (evt.cell.field) {
        case 'reviewComment':
          if (item.reviewData.author) {
            var content = util.reviewStatusTooltipContent(item.reviewData);
            Tooltip.show(content.outerHTML, evt.target, ['below']);
          }
          break;
      }
    },

    onCellMouseOut : function (evt) {
      switch (evt.cell.field) {
        case 'reviewComment':
          Tooltip.hide(evt.target);
          break;
      }
    }
  });

  return declare(TabContainer, {
    constructor : function (args) {
      dojo.safeMixin(this, args);

      var that = this;

      //--- Grid ---//

      this._grid = new ListOfBugsGrid({
        region : 'center',
        runData : this.runData,
        baseline : this.baseline,
        newcheck : this.newcheck,
        difftype : this.difftype
      });

      this._bugOverview = new BorderContainer({
        title : 'Bug Overview',
        onShow : function () {
          if (!this.initalized) {
            this.initalized = true;
            return;
          }

          that._grid.scrollToLastSelected();
          hashHelper.setStateValues({
            'report' : null,
            'reportHash' : null,
            'subtab' : null
          });
        }
      });

      //--- Bug filters ---//

      this._bugFilterView = new BugFilterView({
        class    : 'bug-filters',
        region   : 'left',
        style    : 'width: 300px; padding: 0px;',
        splitter : true,
        diffView : this.baseline || this.newcheck || this.difftype,
        parent   : this,
        runData  : this.runData,
        baseline : this.baseline,
        newcheck : this.newcheck,
        difftype : this.difftype
      });

      //--- Run history ---//

      this._runHistory = new RunHistory({
        title : 'Run history',
        runData : this.runData,
        bugOverView : this._bugOverview,
        bugFilterView : this._bugFilterView,
        parent : this,
        onShow : function () {
          var state = hashHelper.getState();

          hashHelper.resetStateValues({
            'tab' : state.tab,
            'subtab' : 'runHistory'
          });
        }
      });

      this._bugViewerIdToTab = {};
      this._tab = null;

      this._subscribeTopics();
    },

    postCreate : function () {
      var that = this;

      this._bugOverview.addChild(this._bugFilterView);
      this._grid.refreshGrid(that._bugFilterView.getReportFilters());

      this._bugOverview.addChild(this._grid);
      this.addChild(this._bugOverview);

      this.addChild(this._runHistory);

      initByUrl(this._grid);
    },

    _subscribeTopics : function () {
      var that = this;

      this._runHistoryTopic = topic.subscribe('subtab/runHistory', function () {
        that.selectChild(that._runHistory);
      });

      this._bugOverviewTopic = topic.subscribe('subtab/bugOverview', function () {
        that.selectChild(that._bugOverview);
      });

      this._hashChangeTopic = topic.subscribe('/dojo/hashchange',
      function (url) {
        var state = hashHelper.getState();
        if (that._tab === state.tab)
          initByUrl(that._grid);
      });

      this._openFileTopic = topic.subscribe('openFile',
      function (reportData, runData, reportHash, sender) {
        if (sender && sender !== that._grid)
          return;

        if (!that.runData && !that.baseline && !reportHash && !that.allReportView)
          return;

        if (reportData !== null && !(reportData instanceof CC_OBJECTS.ReportData))
          reportData = CC_SERVICE.getReport(reportData);

        var getAndUseReportHash = reportHash && (!reportData ||
          reportData.reportId === null || reportData.bugHash !== reportHash);

        var reportFilters = that._bugFilterView.getReportFilters();
        var runResultParam = createRunResultFilterParameter(reportFilters);

        if (getAndUseReportHash) {
          // Get all reports by report hash
          var reportFilter = new CC_OBJECTS.ReportFilter();
          reportFilter.reportHash = [reportHash];
          reportFilter.isUnique = false;

          reports = CC_SERVICE.getRunResults(null, CC_OBJECTS.MAX_QUERY_SIZE,
            0, null, reportFilter, null);
          reportData = reports[0];
          runData = getRunData(reportData.runId);
          runResultParam.runIds = [reportData.runId];
        }

        if (that._bugViewerIdToTab[reportData.reportId]) {
          that.selectChild(that._bugViewerIdToTab[reportData.reportId]);
          return;
        }

        var filename = reportData.checkedFile.substr(
          reportData.checkedFile.lastIndexOf('/') + 1);

        var bugViewer = new BugViewer({
          title : filename,
          closable : true,
          reportData : reportData,
          runData : runData ? runData : that.runData,
          runResultParam : runResultParam,
          onShow : function () {
            hashHelper.setStateValues({
              'reportHash' : reportData.bugHash,
              'report' : reportData.reportId,
              'subtab' : reportData.reportId
            });

            if (!getAndUseReportHash)
              hashHelper.setStateValue('report', reportData.reportId);
          },
          onClose : function () {
            delete that._bugViewerIdToTab[reportData.reportId];
            topic.publish('subtab/bugOverview');

            return true;
          }
        });
        that._bugViewerIdToTab[reportData.reportId] = bugViewer;

        that.addChild(bugViewer);
        that.selectChild(bugViewer);

        topic.publish('showComments', reportData.reportId, bugViewer._editor);
      });

      this._filterChangeTopic = topic.subscribe('filterchange',
      function (state) {
        if (state.parent !== that._bugFilterView)
          return;

        var reportFilters = that._bugFilterView.getReportFilters();
        that._grid.refreshGrid(reportFilters);
      });
    },

    onShow : function () {
      var state  = this._bugFilterView.getUrlState();
      if (this.allReportView)
        state.tab = 'allReports';
      else
        state.tab = this.runData
          ? this.runData.name
          : this.baseline.name + '_' + this.newcheck.name;

      this._tab  = state.tab;

      if (!this.initalized) {
        this.initalized = true;

        var urlState = hashHelper.getState();
        if (urlState.tab === state.tab)
          return;
      }

      hashHelper.setStateValues(state, true);

      //--- Call show method of the selected children ---//

      this.getChildren().forEach(function (child) {
        if (child.selected)
          child.onShow();
      });
    },

    destroy : function () {
      this.inherited(arguments);
      this._openFileTopic.remove();
      this._filterChangeTopic.remove();
      this._hashChangeTopic.remove();
      this._bugOverviewTopic.remove();
      this._runHistoryTopic.remove();

      // Clear URL if list of bugs view is closed.
      hashHelper.clear();
    }
  });
});
