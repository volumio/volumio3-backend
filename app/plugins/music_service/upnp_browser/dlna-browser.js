// Copyright 2016 the project authors as listed in the AUTHORS file.
// All rights reserved. Use of this source code is governed by the
// license that can be found in the LICENSE file.
'use strict';
const http = require('http');
const url = require('url');
const xmlbuilder = require('xmlbuilder');
const xmltojs = require('xml2js');
const stripPrefix = require('xml2js').processors.stripPrefix;
const Entities = require('html-entities').XmlEntities;

const entities = new Entities();

var debug = false;

// function to build the xml required for the saop request to the DLNA server
const buildRequestXml = function (id, options) {
  // fill in the defaults
  if (!options.browseFlag) {
    options.browseFlag = 'BrowseDirectChildren';
  }

  if (!options.filter) {
    options.filter = '*';
  }

  if (!options.startIndex) {
    options.startIndex = 0;
  }

  if (!options.requestCount) {
    options.requestCount = 1000;
  }

  if (!options.sort) {
    options.sort = '';
  }

  // build the required xml
  return xmlbuilder.create('s:Envelope', { version: '1.0', encoding: 'utf-8' })
    .att('s:encodingStyle', 'http://schemas.xmlsoap.org/soap/encoding/')
    .att('xmlns:s', 'http://schemas.xmlsoap.org/soap/envelope/')
    .ele('s:Body')
    .ele('u:Browse', { 'xmlns:u': 'urn:schemas-upnp-org:service:ContentDirectory:1'})
    .ele('ObjectID', id)
    .up().ele('BrowseFlag', options.browseFlag)
    .up().ele('Filter', options.filter)
    .up().ele('StartingIndex', options.startIndex)
    .up().ele('RequestedCount', options.requestCount)
    .up().ele('SortCriteria', options.sort)
    .doc().end({ pretty: false, indent: '', allowEmpty: true });
};

// function that allow you to browse a DLNA server with automatic pagination
var browseServer = function (id, controlUrl, options, callback) {
  // Initialize aggregated results
  var aggregatedResult = {
    container: [],
    item: []
  };

  // Start recursive pagination from index 0 (or provided startIndex)
  var initialStartIndex = options.startIndex || 0;
  browsePage(id, controlUrl, options, initialStartIndex, aggregatedResult, callback);
};

// Internal function to browse a single page and handle pagination
var browsePage = function (id, controlUrl, options, startIndex, aggregatedResult, callback) {
  log('DLNA Browse: Requesting id=' + id + ', browseFlag=' + (options.browseFlag || 'BrowseDirectChildren'));
  var parser = new xmltojs.Parser({explicitCharKey: true});
  const requestUrl = url.parse(controlUrl);

  // Create options copy with current startIndex
  var pageOptions = Object.assign({}, options);
  pageOptions.startIndex = startIndex;

  var requestXml;
  try {
    requestXml = buildRequestXml(id, pageOptions);
  } catch (err) {
    // something must have been wrong with the options specified
    callback(err);
    return;
  }

  const httpOptions = {
    protocol: 'http:',
    host: requestUrl.hostname,
    port: requestUrl.port,
    path: requestUrl.path,
    method: 'POST',
    headers: { 'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
      'Content-Length': Buffer.byteLength(requestXml, 'utf8'),
      'Content-Type': 'text/xml',
      'User-Agent': 'Android UPnP/1.0 DLNADOC/1.50'}
  };

  const req = http.request(httpOptions, function (response) {
    var data = '';
    response.on('data', function (newData) {
      data = data + newData;
    });

    response.on('err', function (err) {
      log(callback(err));
    });

    response.on('end', function () {
      var browseResult = new Object();
      xmltojs.parseString(entities.decode(data), {tagNameProcessors: [stripPrefix], explicitArray: true, explicitCharkey: true}, function (err, result) {
        if (err) {
          log(err);
          // bailout on error
          callback(err);
          return;
        }

        // validate result included the expected entries
        if ((result != undefined) &&
            (result['Envelope']) &&
            (result['Envelope']['Body']) &&
            (result['Envelope']['Body'][0]) &&
            (result['Envelope']['Body'][0]['BrowseResponse']) &&
            (result['Envelope']['Body'][0]['BrowseResponse'][0]) &&
            (result['Envelope']['Body'][0]['BrowseResponse'][0]['Result']) &&
            (result['Envelope']['Body'][0]['BrowseResponse'][0]['Result'][0])
        ) {
          var browseResponse = result['Envelope']['Body'][0]['BrowseResponse'][0];
          var listResult = browseResponse['Result'][0];

          // Extract pagination info
          var numberReturned = 0;
          var totalMatches = 0;
          try {
            if (browseResponse['NumberReturned'] && browseResponse['NumberReturned'][0]) {
              var nrValue = browseResponse['NumberReturned'][0];
              numberReturned = parseInt(typeof nrValue === 'object' ? nrValue['_'] : nrValue, 10) || 0;
            }
            if (browseResponse['TotalMatches'] && browseResponse['TotalMatches'][0]) {
              var tmValue = browseResponse['TotalMatches'][0];
              totalMatches = parseInt(typeof tmValue === 'object' ? tmValue['_'] : tmValue, 10) || 0;
            }
          } catch (e) {
            log('Error parsing pagination info: ' + e);
          }

          log('DLNA Browse: startIndex=' + startIndex + ', numberReturned=' + numberReturned + ', totalMatches=' + totalMatches);

          if (listResult['DIDL-Lite']) {
            const content = listResult['DIDL-Lite'][0];
            log('DLNA Browse: content.container exists=' + !!content.container + ', content.item exists=' + !!content.item);
            if (content.container) {
              log('DLNA Browse: container count in this page=' + content.container.length);
            }
            if (content.item) {
              log('DLNA Browse: item count in this page=' + content.item.length);
            }

            // Aggregate containers from this page
            if (content.container) {
              for (let i = 0; i < content.container.length; i++) {
                aggregatedResult.container.push(parseContainer(content.container[i]));
              }
            }

            // Aggregate items from this page
            if (content.item) {
              for (let i = 0; i < content.item.length; i++) {
                aggregatedResult.item.push(parseItem(content.item[i]));
              }
            }

            // Check if more pages needed
            var nextStartIndex = startIndex + numberReturned;
            var currentPageCount = (content.container ? content.container.length : 0) + (content.item ? content.item.length : 0);

            // Only paginate if:
            // 1. Server explicitly tells us there are more (totalMatches > nextStartIndex)
            // 2. AND we actually got some results this page (numberReturned > 0 OR currentPageCount > 0)
            var hasMorePages = totalMatches > 0 && nextStartIndex < totalMatches && (numberReturned > 0 || currentPageCount > 0);

            if (hasMorePages) {
              // Fetch next page
              log('DLNA Browse: Fetching next page, nextStartIndex=' + nextStartIndex);
              browsePage(id, controlUrl, options, nextStartIndex, aggregatedResult, callback);
            } else {
              // All pages fetched, return aggregated result
              var finalResult = {};
              if (aggregatedResult.container.length > 0) {
                finalResult.container = aggregatedResult.container;
              }
              if (aggregatedResult.item.length > 0) {
                finalResult.item = aggregatedResult.item;
              }
              log('DLNA Browse: Complete, total containers=' + aggregatedResult.container.length + ', total items=' + aggregatedResult.item.length);
              callback(undefined, finalResult);
            }
          } else {
            callback(new Error('Did not get expected listResult from server:' + result));
          }
        } else {
          if (result != undefined) {
            callback(new Error('Did not get expected response from server:' + JSON.stringify(result)));
          } else {
            callback(new Error('Did not get any response from server:'));
          }
        }
      });
    });
  });
  req.on('error', function (err) {
    callback(err);
    req.abort();
  });
  req.write(requestXml);
  req.end();
};

function parseContainer (metadata) {
  var container = {
    'class': '',
    'title': '',
    'id': '',
    'parentId': '',
    'children': ''
  };
  try {
    if (metadata) {
      if (metadata.title) {
        container.title = metadata.title[0]['_'];
      }
      if (metadata.artist) {
        container.artist = metadata.artist[0]['_'];
      }
      if (metadata.class) {
        container.class = metadata.class[0]['_'];
      }
      if (metadata['$']) {
        if (metadata['$'].id) {
          container.id = metadata['$'].id;
        }
        if (metadata['$'].parentID) {
          container.parentId = metadata['$'].parentID;
        }
        if (metadata['$'].childCount) {
          container.children = metadata['$'].childCount;
        }
      }
    }
  } catch (e) {
    log(e);
  }
  return container;
}

function parseItem (metadata) {
  var item = {
    'class': '',
    'id': '',
    'title': '',
    'artist': '',
    'album': '',
    'parentId': '',
    'duration': '',
    'source': '',
    'image': ''};
  if (metadata) {
    if (metadata.class) {
      item.class = metadata.class[0]['_'];
    }
    if (metadata.title) {
      item.title = metadata.title[0]['_'];
    }
    if (metadata.artist) {
      item.artist = metadata.artist[0]['_'];
    }
    if (metadata.album) {
      item.album = metadata.album[0]['_'];
    }
    if (metadata.res) {
      item.source = metadata.res[0]['_'];
      if (metadata.res[0]['$'].duration) {
        var dur = metadata.res[0]['$'].duration;
        var time = dur.split(':');
        item.duration = parseInt(parseFloat(time[0]) * 3600 + parseFloat(time[1]) * 60 + parseFloat(time[2]));
      }
    }
    if (metadata.albumArtURI) {
      item.image = metadata.albumArtURI[0]['_'];
    }
    if (metadata['$']) {
      if (metadata['$'].id) {
        item.id = metadata['$'].id;
      }
      if (metadata['$'].parentID) {
        item.parentId = metadata['$'].parentID;
      }
    }
  }
  return item;
}

function log (message) {
  if (debug) {
    console.log(message);
  }
}

module.exports = browseServer;
