/** Simple uPnP Gateway device. It allows to map ports from external to internal
 * interfaces.
 *
 * @constructor
 * @see https://gist.github.com/acacio/1603181
 */
module.exports = function Gateway() {

  /** SSDP service port.
   * @constant
   * @private
   * @fieldOf Gateway#
   */
  var SSDP_PORT = 1900;

  /** SSDP service broadcast address.
   * @constant
   * @private
   * @fieldOf Gateway#
   */
  var SSDP_BROADCAST_ADDR = "239.255.255.250";

  /** Standard uPnP InternetGateway device root id.
   * @constant
   * @private
   * @fieldOf Gateway#
   * @see http://upnp.org/specs/gw/upnp-gw-internetgatewaydevice-v1-device.pdf
   */
  var ST = "urn:schemas-upnp-org:device:InternetGatewayDevice:1";

  /** uPnP search gateway request.
   * @constant
   * @private
   * @fieldOf Gateway#
   */
  var SEARCH_GATEWAY_REQUEST = "M-SEARCH * HTTP/1.1\r\n" +
    "Host:" + SSDP_BROADCAST_ADDR + ":" + SSDP_PORT + "\r\n" +
    "ST:" + ST + "\r\n" +
    "Man:\"ssdp:discover\"\r\n" +
    "MX:3\r\n\r\n";

  /** Standard uPnP WANIPConnection device root id.
   * @constant
   * @private
   * @fieldOf Gateway#
   * @see http://www.upnp.org/specs/gw/UPnP-gw-WANIPConnection-v1-Service.pdf
   */
  var WANIP = "urn:schemas-upnp-org:service:WANIPConnection:1";

  /** SSDP sucessful response.
   * @constant
   * @private
   * @fieldOf Gateway#
   */
  var OK = "HTTP/1.1 200 OK";

  /** Node's UDP API.
   * @private
   * @fieldOf Gateway#
   */
  var dgram = require("dgram");

  /** Node's URL API.
   * @private
   * @fieldOf Gateway#
   */
  var url = require("url");

  /** XML document parser library.
   * @private
   * @fieldOf Gateway#
   */
  var xmldoc = require('xmldoc');

  /** Node's HTTP API.
   * @private
   * @fieldOf Gateway#
   */
  var http = require("http");

  /** Node's operating system API.
   * @private
   * @fieldOf Gateway#
   */
  var os = require('os')

  /** Gateway address information. It's never null after initializeGateway().
   * @private
   * @fieldOf Gateway#
   */
  var addressInfo;

  /** Parses an HTTP response header string.
   * @param {String} response Raw HTTP headers. Cannot be null or empty.
   * @return {Object} Returns an object containing the headers and a special
   *    property STATUS_LINE to access the HTTP status code. Never returns
   *    null.
   * @private
   * @methodOf Gateway#
   */
  var parseResponseHeaders = function (response) {
    var lines = response.split("\r\n");
    var field = lines.shift();
    var name;
    var value;
    var headers = {
      STATUS_LINE: field
    };

    while (field = lines.shift()) {
      name = field.substr(0, field.indexOf(":"));
      value = field.substr(field.indexOf(":") + 1).replace(/^\s+/, "")
        .replace(/\s+$/, "");
      headers[name.toUpperCase()] = value;
    }

    return headers;
  };

  /** Searches for the gateway location using the SSDP discovery service.
   * @param {Function} callback Callback invoked once gateway is found. It takes
   *    an error and the gateway location URL. Cannot be null.
   * @private
   * @methodOf Gateway#
   */
  var lookupGatewayLocation = function (callback) {
    var request  = new Buffer(SEARCH_GATEWAY_REQUEST, "ascii");
    var socket  = new dgram.Socket("udp4", function (msg, rinfo) {
      var headers = parseResponseHeaders(msg.toString());

      if (headers.STATUS_LINE !== OK ||
        !headers.ST || !headers.LOCATION) {
        return;
      }

      callback(null, headers.LOCATION);
      socket.close();
    });

    socket.on("error", function (err) {
      socket.close();
      callback(err);
    });

    socket.bind(SSDP_PORT, function () {
      socket.setBroadcast(true);
      socket.send(request, 0, request.length, SSDP_PORT, SSDP_BROADCAST_ADDR);
    });
  };

  /** Searches for the WANIP device's control URL.
   * @param {String} responseXml Gateway XML response containing all uPnP
   *    available devices. Cannot be null or empty.
   * @param {Function} callback Callback invoked when the control url is found.
   *    It takes an error and the control url as parameters. Cannot be null.
   * @private
   * @methodOf Gateway#
   */
  var findWanIpControlUrl = function (responseXml, callback) {
    var findNext = function (node) {
      if (!node) {
        callback(new Error("WANIP device not found."));
        return;
      }
      node.children.forEach(function (child) {
        var controlUrl = node.childNamed("controlURL");

        if (child.name === "serviceType" && child.val === WANIP &&
          controlUrl) {
          callback(null, controlUrl.val);
          return;
        }

        findNext(child);
      });
    };
    findNext(new xmldoc.XmlDocument(responseXml));
  };

  /** Sends a SOAP message to the gateway.
   * @param {String} message A valid gateway message. Cannot be null or empty.
   * @param {String} method Gateway method that handles the message. Cannot be
   *    null or empty.
   * @param {Function} callback Callback invoked to receive the gateway
   *    response. It takes an error and the response string as parameters.
   *    Cannot be null.
   * @private
   * @methodOf Gateway#
   */
  var sendSoapMessage = function (message, method, callback) {
    var SOAP_ENV_PRE = "<?xml version=\"1.0\"?>\n<s:Envelope \n" +
      "xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" \n" +
      "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
      "<s:Body>\n";
    var SOAP_ENV_POST = "</s:Body>\n</s:Envelope>\n";

    var requestXml = SOAP_ENV_PRE + message + SOAP_ENV_POST;
    var options = {
      hostname: addressInfo.hostname,
      port: addressInfo.port,
      path: addressInfo.path,
      method: 'POST',
      headers: {
        "Host": addressInfo.hostname,
        "SOAPACTION": "\"" + WANIP + "#" + method + "\"",
        "Content-Type": "text/xml",
        "Content-Length": requestXml.length
      }
    };
    var req = http.request(options, function (res) {
      var data = "";

      if (res.statusCode !== 200) {
        callback(new Error("Invalid SOAP action"));
        return;
      }

      res.on("data", function (chunk) {
        data += chunk.toString();
      });
      res.on("end", function () {
        callback(null, data);
      });
    }).on('error', function (err) {
      callback(err);
    });

    req.write(requestXml);
    req.end();
  };

  /** Returns a list of local ip addresses defined by existing interfaces.
   *
   * @return {String[]} Returns a list of local ip addresses, never returns
   *    null.
   * @private
   * @methodOf Gateway#
   */
  var getLocalAddresses = function () {
    var interfaces = os.networkInterfaces();
    var addresses = [];
    var interfaceName;

    for (interfaceName in interfaces) {
      if (interfaces.hasOwnProperty(interfaceName)) {
        interfaces[interfaceName].forEach(function (addressInfo) {
          if (addressInfo.family == 'IPv4' && !addressInfo.internal) {
            addresses.push(addressInfo.address)
          }
        });
      }
    }

    return addresses;
  };

  /** Look-ups the gateway device and prepares it to start sending messages.
   *
   * @param {Function} callback Callback notified when the gateway is
   *    initialized. It takes an error as parameter. Cannot be null.
   * @private
   * @methodOf Gateway#
   */
  var initializeGateway = function (callback) {
    lookupGatewayLocation(function (err, gatewayLocation) {
      if (err) {
        callback(err);
        return;
      }

      http.get(gatewayLocation, function (response) {
        var xml = "";

        if (response.statusCode !== 200) {
          callback(new Error("Cannot connect to gateway: " + gatewayLocation));
          return;
        }

        response.on('data', function (chunk) {
          xml += chunk.toString();
        });
        response.on("end", function () {
          findWanIpControlUrl(xml, function (err, controlUrl) {
            var gatewayUrl = url.parse(gatewayLocation);

            if (err) {
              callback(err);
              return;
            }

            addressInfo = {
              path: controlUrl,
              hostname: gatewayUrl.hostname,
              port: gatewayUrl.port
            };

            callback(null);
          });
        });
      }).on('error', function (err) {
        callback(err);
      });
    });
  };

  return {

    /** Notifies when the gateway is ready to be used.
     * @param {Function} callback Callback invoked when the gateway is ready.
     *    It takes an error as parameter. Cannot be null.
     */
    ready: function (callback) {
      initializeGateway(callback);
    },

    /** Retrieves the network's public IP address.
     * @param {Function} callback Callback notified when the external IP address
     *    is available. It takes an error and the ip address as parameters.
     *    Cannot be null.
     */
    getExternalAddress: function (callback) {
      var message = "<u:GetExternalIPAddress xmlns:u=\"" + WANIP + "\">" +
        "</u:GetExternalIPAddress>\n";

      sendSoapMessage(message, "GetExternalIPAddress", function (err, xml) {
        if (err) {
          callback(err);
        } else {
          callback(null, xml
            .match(/<NewExternalIPAddress>(.+?)<\/NewExternalIPAddress>/i)[1])
        }
      });
    },

    /** Adds a port mapping for the specified protocol to all local interfaces.
     * @param {String} protocol Protocol name. Cannot be null or empty.
     * @param {Number} port Port to map from external to internal interfaces.
     *    Must be greater than 0.
     * @param {Function} callback Callback notified when the port mapping
     *    finished. It takes an error as parameter. Cannot be null.
     */
    openPort: function (protocol, port, callback) {
      var addresses = getLocalAddresses();
      var addNextMapping = function (address, err, res) {
        var message;

        if (!address || err) {
          callback(err, res);
          return;
        }

        message =
          "<u:AddPortMapping xmlns:u=\"" + WANIP + "\">\n" +
          "<NewRemoteHost></NewRemoteHost>\n" +
          "<NewExternalPort>" + port + "</NewExternalPort>\n" +
          "<NewProtocol>" + protocol + "</NewProtocol>\n" +
          "<NewInternalPort>" + port + "</NewInternalPort>\n" +
          "<NewInternalClient>" + address + "</NewInternalClient>\n" +
          "<NewEnabled>1</NewEnabled>\n" +
          "<NewPortMappingDescription>desc</NewPortMappingDescription>\n" +
          "<NewLeaseDuration>0</NewLeaseDuration>\n" +
          "</u:AddPortMapping>";

        sendSoapMessage(message, "AddPortMapping",
          addNextMapping.bind(this, addresses.shift()));
      };
      addNextMapping(addresses.shift());
    }
  }
}