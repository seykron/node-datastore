var fs = require("fs");
var path = require("path");
var async = require("async");
var winston = require("winston");

var DEVICE1_DIR = path.join(require("os").tmpDir(), "node-datastore", "device0");
var DEVICE2_DIR = path.join(require("os").tmpDir(), "node-datastore", "device1");

var NetworkDataStore = require("../lib/NetworkDataStore");
var dataStore1 = new NetworkDataStore(DEVICE1_DIR);
var dataStore2 = new NetworkDataStore(DEVICE2_DIR);

winston.setLevels(winston.config.syslog.levels);

async.series([
  dataStore1.initialize,
  dataStore2.initialize,
  function removeIndex(callback) {
    // Deletes existing index.
    if (fs.existsSync(DEVICE1_DIR + "/index.json")) {
      fs.unlinkSync(path.join(DEVICE1_DIR, "index.json"));
    }
    if (fs.existsSync(DEVICE2_DIR + "/index.json")) {
      fs.unlinkSync(path.join(DEVICE2_DIR, "/index.json"));
    }
    callback(null);
  }
], function (err) {
  var item;

  if (err) {
    throw err;
  }

  dataStore1.join(dataStore2.getLocalNode());
  dataStore2.join(dataStore1.getLocalNode());

  async.series([
    // Adds a file to the first data store.
    function createContent(callback) {
      var stream = fs.createReadStream(__dirname +
        "/../../asset/books_world.png");

      dataStore1.save(stream, null, {
        name: "books_world.png"
      }, function (err, newItem) {
        item = newItem;
        callback(err);
      });
    }
  ], function (err) {
    if (err) {
      throw err;
    }

    // Retrieves content from dataStore2, which is in the same network than
    // dataStore1 but it doesn't have the required content.
    dataStore2.get(item.getId(), null, function (err, remoteItem) {
      if (err) {
        console.log(err);
      } else {
        console.log("Item downloaded into the local file system.");
        process.exit();
      }
    });
  });
});
