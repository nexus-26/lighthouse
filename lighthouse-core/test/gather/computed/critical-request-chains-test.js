/**
 * @license Copyright 2016 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env mocha */

const assert = require('assert');
const CriticalRequestChains = require('../../../gather/computed/critical-request-chains');
const WebInspector = require('../../../lib/web-inspector');
const Runner = require('../../../runner.js');

const HIGH = 'High';
const VERY_HIGH = 'VeryHigh';
const MEDIUM = 'Medium';
const LOW = 'Low';
const VERY_LOW = 'VeryLow';

function mockTracingData(prioritiesList, edges) {
  const networkRecords = prioritiesList.map((priority, index) =>
    ({requestId: index.toString(),
      _resourceType: {
        _category: 'fake',
      },
      _frameId: 1,
      finished: true,
      priority: () => priority,
      initiatorRequest: () => null,
    }));

  // add mock initiator information
  edges.forEach(edge => {
    const initiator = networkRecords[edge[0]];
    networkRecords[edge[1]].initiatorRequest = () => initiator;
  });

  return networkRecords;
}

function replaceChain(chains, networkRecords) {
  Object.keys(chains).forEach(chainId => {
    const chain = chains[chainId];
    chain.request = networkRecords.find(record => record._requestId === chainId);
    replaceChain(chain.children, networkRecords);
  });
}

describe('CriticalRequestChain gatherer: extractChain function', () => {
  it('returns correct data for chain from a devtoolsLog', () => {
    const computedArtifacts = Runner.instantiateComputedArtifacts();
    const wikiDevtoolsLog = require('../../fixtures/wikipedia-redirect.devtoolslog.json');
    const wikiChains = require('../../fixtures/wikipedia-redirect.critical-request-chains.json');
    const URL = {finalUrl: 'https://en.m.wikipedia.org/wiki/Main_Page'};

    const networkPromise = computedArtifacts.requestNetworkRecords(wikiDevtoolsLog);
    const CRCPromise = computedArtifacts.requestCriticalRequestChains({devtoolsLog: wikiDevtoolsLog,
      URL});
    return Promise.all([CRCPromise, networkPromise]).then(([chains, networkRecords]) => {
      // set all network requests based on requestid
      replaceChain(wikiChains, networkRecords);
      assert.deepEqual(chains, wikiChains);
    });
  });

  it('returns correct data for chain of four critical requests', () => {
    const networkRecords = mockTracingData(
      [HIGH, MEDIUM, VERY_HIGH, HIGH],
      [[0, 1], [1, 2], [2, 3]]
    );
    const mainResource = networkRecords[0];
    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          1: {
            request: networkRecords[1],
            children: {
              2: {
                request: networkRecords[2],
                children: {
                  3: {
                    request: networkRecords[3],
                    children: {},
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('returns correct data for chain interleaved with non-critical requests',
    () => {
      const networkRecords = mockTracingData(
        [MEDIUM, HIGH, LOW, MEDIUM, HIGH, VERY_LOW],
        [[0, 1], [1, 2], [2, 3], [3, 4]]
      );
      const mainResource = networkRecords[0];
      const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
      assert.deepEqual(criticalChains, {
        0: {
          request: networkRecords[0],
          children: {
            1: {
              request: networkRecords[1],
              children: {},
            },
          },
        },
      });
    }
  );

  it('returns correct data for two parallel chains', () => {
    const networkRecords = mockTracingData([HIGH, HIGH, HIGH, HIGH], [[0, 2], [1, 3]]);
    const mainResource = networkRecords[0];
    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          2: {
            request: networkRecords[2],
            children: {},
          },
        },
      },
      1: {
        request: networkRecords[1],
        children: {
          3: {
            request: networkRecords[3],
            children: {},
          },
        },
      },
    });
  });

  it('returns correct data for fork at non root', () => {
    const networkRecords = mockTracingData([HIGH, HIGH, HIGH, HIGH], [[0, 1], [1, 2], [1, 3]]);
    const mainResource = networkRecords[0];
    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          1: {
            request: networkRecords[1],
            children: {
              2: {
                request: networkRecords[2],
                children: {},
              },
              3: {
                request: networkRecords[3],
                children: {},
              },
            },
          },
        },
      },
    });
  });

  it('returns empty chain list when no critical request', () => {
    const networkRecords = mockTracingData([LOW, LOW], [[0, 1]]);
    const mainResource = networkRecords[0];
    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {});
  });

  it('returns empty chain list when no request whatsoever', () => {
    const networkRecords = mockTracingData([], []);
    const mainResource = networkRecords[0];
    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {});
  });

  it('returns two single node chains for two independent requests', () => {
    const networkRecords = mockTracingData([HIGH, HIGH], []);
    const mainResource = networkRecords[0];
    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {},
      },
      1: {
        request: networkRecords[1],
        children: {},
      },
    });
  });

  it('returns correct data on a random big graph', () => {
    const networkRecords = mockTracingData(
      Array(9).fill(HIGH),
      [[0, 1], [1, 2], [1, 3], [4, 5], [5, 7], [7, 8], [5, 6]]
    );
    const mainResource = networkRecords[0];
    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          1: {
            request: networkRecords[1],
            children: {
              2: {
                request: networkRecords[2],
                children: {},
              },
              3: {
                request: networkRecords[3],
                children: {},
              },
            },
          },
        },
      },
      4: {
        request: networkRecords[4],
        children: {
          5: {
            request: networkRecords[5],
            children: {
              7: {
                request: networkRecords[7],
                children: {
                  8: {
                    request: networkRecords[8],
                    children: {},
                  },
                },
              },
              6: {
                request: networkRecords[6],
                children: {},
              },
            },
          },
        },
      },
    });
  });

  it('handles redirects', () => {
    const networkRecords = mockTracingData([HIGH, HIGH, HIGH], [[0, 1], [1, 2]]);
    const mainResource = networkRecords[0];

    // Make a fake redirect
    networkRecords[1].requestId = '1:redirected.0';
    networkRecords[2].requestId = '1';

    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {
          '1:redirected.0': {
            request: networkRecords[1],
            children: {
              1: {
                request: networkRecords[2],
                children: {},
              },
            },
          },
        },
      },
    });
  });

  it('discards favicons as non-critical', () => {
    const networkRecords = mockTracingData([HIGH, HIGH, HIGH, HIGH], [[0, 1], [0, 2], [0, 3]]);
    const mainResource = networkRecords[0];

    // 2nd record is a favicon
    networkRecords[1]._url = 'https://example.com/favicon.ico';
    networkRecords[1]._mimeType = 'image/x-icon';
    networkRecords[1].parsedURL = {
      lastPathComponent: 'favicon.ico',
    };
    // 3rd record is a favicon
    networkRecords[2].url = 'https://example.com/favicon-32x32.png';
    networkRecords[2]._mimeType = 'image/png';
    networkRecords[2].parsedURL = {
      lastPathComponent: 'favicon-32x32.png',
    };
    // 4th record is a favicon
    networkRecords[3].url = 'https://example.com/android-chrome-192x192.png';
    networkRecords[3]._mimeType = 'image/png';
    networkRecords[3].parsedURL = {
      lastPathComponent: 'android-chrome-192x192.png',
    };

    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {},
      },
    });
  });

  it('discards iframes as non-critical', () => {
    const networkRecords = mockTracingData([HIGH, HIGH, HIGH], [[0, 1], [0, 2]]);
    const mainResource = networkRecords[0];

    // 1th record is the root document
    networkRecords[0]._url = 'https://example.com';
    networkRecords[0]._mimeType = 'text/html';
    networkRecords[0]._resourceType = WebInspector.resourceTypes.Document;
    // 2nd record is an iframe in the page
    networkRecords[1]._url = 'https://example.com/iframe.html';
    networkRecords[1]._mimeType = 'text/html';
    networkRecords[1]._resourceType = WebInspector.resourceTypes.Document;
    networkRecords[1]._frameId = '2';
    // 3rd record is an iframe loaded by a script
    networkRecords[2]._url = 'https://youtube.com/';
    networkRecords[2]._mimeType = 'text/html';
    networkRecords[2]._resourceType = WebInspector.resourceTypes.Document;
    networkRecords[2]._frameId = '3';

    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[0],
        children: {},
      },
    });
  });

  it('handles non-existent nodes when building the tree', () => {
    const networkRecords = mockTracingData([HIGH, HIGH], [[0, 1]]);
    const mainResource = networkRecords[0];

    // Reverse the records so we force nodes to be made early.
    networkRecords.reverse();
    const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
    assert.deepEqual(criticalChains, {
      0: {
        request: networkRecords[1],
        children: {
          1: {
            request: networkRecords[0],
            children: {},
          },
        },
      },
    });
  });

  it('returns correct data for chain with preload',
    () => {
      const networkRecords = mockTracingData(
        [HIGH, HIGH],
        [[0, 1]]
      );
      networkRecords[1]._isLinkPreload = true;
      const mainResource = networkRecords[0];
      const criticalChains = CriticalRequestChains.extractChain(networkRecords, mainResource);
      assert.deepEqual(criticalChains, {
        0: {
          request: networkRecords[0],
          children: {},
        },
      });
    }
  );
});
