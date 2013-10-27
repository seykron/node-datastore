var fs = require("fs");
var path = require("path");
var async = require("async");
var winston = require("winston");

var DS_DIR = path.join(require("os").tmpDir(), "node-datastore");
var INDEX1_DIR = path.join(DS_DIR, "device0");
var INDEX2_DIR = path.join(DS_DIR, "device1");

var Swarm = require("../lib/Swarm");
var NetworkManager = require("../lib/NetworkManager");
var NetworkIndex = require("../lib/NetworkIndex");

var swarm = new Swarm(DS_DIR);
var networkManager = new NetworkManager(swarm);
var index1;
var index2;

winston.setLevels(winston.config.syslog.levels);

networkManager.initialize(function (err) {
  if (err) {
    throw err;
  }

  // Deletes existing index.
  if (fs.existsSync(INDEX1_DIR + "/index.json")) {
    fs.unlinkSync(path.join(INDEX1_DIR, "index.json"));
  }
  if (fs.existsSync(INDEX2_DIR + "/index.json")) {
    fs.unlinkSync(path.join(INDEX2_DIR, "/index.json"));
  }

  index1 = new NetworkIndex(INDEX1_DIR, networkManager);
  index2 = new NetworkIndex(INDEX2_DIR, networkManager);

  async.series([
    // Creates some random items.
    function createItems(callback) {
      async.parallel([
        index1.createItem.bind(this, "foo", {
          name: "foo.item"
        }),
        index2.createItem.bind(this, "bar", {
          name: "bar.item"
        })
      ], callback);
    },
  ], function (err) {
    // Asks for an unexisting item in index1.
    index1.getItem("bar", function (err, item) {
      if (err) {
        throw err;
      }
      // The item is taken from index2.
      console.log(item.getMetadata());
      process.exit();
    });
  });
});
