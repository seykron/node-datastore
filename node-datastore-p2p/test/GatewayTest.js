var Gateway = require("../lib/Gateway");
var gateway = new Gateway("desc");

gateway.ready(function (err) {
  if (err) {
    throw err;
  }
  gateway.listOpenPorts(function (err, entries) {
    if (err) {
      console.log(err);
    } else {
      console.log(entries);

      gateway.closePort("tcp", null, function (err) {
        if (err) {
          console.log(err);
        } else {
          console.log("All TCP ports closed.");
        }
      });
    }
  });
});
