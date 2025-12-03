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

// Internal function to browse a single page
var browsePage = function (id, controlUrl, options, wrappedCallback, accumulatedResult) {
  var parser = new xmltojs.Parser({explicitCharKey: true});
  const requestUrl = url.parse(controlUrl);

  // Defensive: ensure options is an object
  options = options || {};

  var requestXml;
  try {
    requestXml = buildRequestXml(id, options);
  } catch (err) {
    // something must have been wrong with the options specified
    // Return immediately to prevent continued execution
    return wrappedCallback(err);
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
      log(err);
      return wrappedCallback(err);
    });

    response.on('end', function () {
      xmltojs.parseString(entities.decode(data), {tagNameProcessors: [stripPrefix], explicitArray: true, explicitCharkey: true}, function (err, result) {
        if (err) {
          log(err);
          // bailout on error - return immediately
          return wrappedCallback(err);
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
          var listResult = result['Envelope']['Body'][0]['BrowseResponse'][0]['Result'][0];
          var browseResponse = result['Envelope']['Body'][0]['BrowseResponse'][0];
          
          // Extract pagination metadata
          var numberReturned = 0;
          var totalMatches = 0;
          
          if (browseResponse['NumberReturned'] && browseResponse['NumberReturned'][0]) {
            numberReturned = parseInt(browseResponse['NumberReturned'][0], 10) || 0;
          }
          
          if (browseResponse['TotalMatches'] && browseResponse['TotalMatches'][0]) {
            totalMatches = parseInt(browseResponse['TotalMatches'][0], 10) || 0;
          }

          var currentPageResult = {
            container: [],
            item: []
          };

          if (listResult['DIDL-Lite']) {
            const content = listResult['DIDL-Lite'][0];
            if (content.container) {
              for (let i = 0; i < content.container.length; i++) {
                currentPageResult.container.push(parseContainer(content.container[i]));
              }
            }

            if (content.item) {
              for (let i = 0; i < content.item.length; i++) {
                currentPageResult.item.push(parseItem(content.item[i]));
              }
            }
          }

          // Accumulate results
          accumulatedResult.container = accumulatedResult.container.concat(currentPageResult.container);
          accumulatedResult.item = accumulatedResult.item.concat(currentPageResult.item);

          // Calculate next start index
          var currentStartIndex = parseInt(options.startIndex, 10) || 0;
          var nextStartIndex = currentStartIndex + numberReturned;
          var currentPageCount = currentPageResult.container.length + currentPageResult.item.length;

          log('Pagination: numberReturned=' + numberReturned + ', totalMatches=' + totalMatches + 
              ', currentPageCount=' + currentPageCount + ', nextStartIndex=' + nextStartIndex);

          // Determine if we should fetch more pages
          // Use fallback heuristic: continue if totalMatches > 0 and nextStartIndex < totalMatches
          // OR (numberReturned > 0 and currentPageCount > 0) to handle servers without TotalMatches
          var shouldContinue = false;
          if (totalMatches > 0 && nextStartIndex < totalMatches) {
            shouldContinue = true;
          } else if (numberReturned > 0 && currentPageCount > 0 && totalMatches === 0) {
            // Fallback: server doesn't provide TotalMatches, continue while we get results
            shouldContinue = true;
          }

          if (shouldContinue) {
            // Fetch next page
            var pageOptions = Object.assign({}, options);
            pageOptions.startIndex = nextStartIndex;
            return browsePage(id, controlUrl, pageOptions, wrappedCallback, accumulatedResult);
          } else {
            // All pages fetched, return accumulated results
            return wrappedCallback(undefined, accumulatedResult);
          }
        } else {
          if (result != undefined) {
            return wrappedCallback(new Error('Did not get expected response from server:' + JSON.stringify(result)));
          } else {
            return wrappedCallback(new Error('Did not get any response from server:'));
          }
        }
      });
    });
  });
  req.on('error', function (err) {
    req.abort();
    return wrappedCallback(err);
  });
  req.write(requestXml);
  req.end();
};

// function that allow you to browse a DLNA server
var browseServer = function (id, controlUrl, options, callback) {
  // Defensive: ensure options is an object
  options = options || {};
  
  // Normalize and coerce startIndex to integer
  var initialStartIndex = parseInt(options.startIndex, 10) || 0;
  options.startIndex = initialStartIndex;

  // Wrap callback with once-guard to ensure it's only called once
  var finished = false;
  var wrappedCallback = function (err, result) {
    if (finished) {
      log('Warning: callback already invoked, ignoring subsequent call');
      return;
    }
    finished = true;
    
    // Ensure consistent result shape - always include container and item arrays
    if (!err && result) {
      result.container = result.container || [];
      result.item = result.item || [];
    }
    
    callback(err, result);
  };

  // Initialize accumulated result with empty arrays
  var accumulatedResult = {
    container: [],
    item: []
  };

  // Start pagination
  browsePage(id, controlUrl, options, wrappedCallback, accumulatedResult);
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
