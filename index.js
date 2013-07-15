/** Data store example using file system and default OS temp dir.
 */
var TEST_FILES = ["books_world.png", "bee.jpg"];
var NUMBER_OF_DEVICES = 3;

var os = require("os");
var fs = require("fs");
var path = require("path");
var ds = require("./node-datastore");
var fsds = require("./node-datastore-fs");
var baseDir = path.join(os.tmpDir(), "node-datastore");
var devices = (function () {
  var result = [];

  for (var i = 0; i < NUMBER_OF_DEVICES; i++) {
    result.push(new fsds.FileSystemDevice(path.join(baseDir, "device" + i)));
  }

  return result;
}());
var sync = TEST_FILES.length;

var index = new fsds.FileSystemIndex(baseDir);
var dataStore = new ds.DataStore(index, devices, {
  errorHandler: function (err, id, namespace, type) {
    console.log(err);
  }
});

var start = Date.now();

TEST_FILES.forEach(function (testFile) {
  var fullPath = path.join(".", "asset", testFile);
  var readStream = fs.createReadStream(fullPath);
  var stats = fs.statSync(fullPath);

  dataStore.save(readStream, null, {
    size: stats.size,
    name: testFile
  }, function (err, item) {
    sync -= 1;
    console.log({
      id: item.getId(),
      metadata: item.getMetadata()
    });

    if (sync === 0) {
      dataStore.close(function (err) {
        console.log("total time: "+ (Date.now() - start) + "ms");
      });
    }
  });
});
