/** Keeps a map of existing peers in the local machine's network.
 * @param {String} baseDir Directory where network descriptors are stored.
 *    Cannot be null or empty.
 * @constructor
 */
module.exports = function Swarm (baseDir) {

  /** Node's path API.
   * @type {Object}
   * @private
   * @fieldOf Swarm#
   */
  var path = require("path");

  /** Node's file system API.
   * @type {Object}
   * @private
   * @fieldOf Swarm#
   */
  var fs = require("fs");

  /** Directory where peer descriptors are stored.
   * @constant
   * @type {String}
   * @private
   * @fieldOf Swarm#
   */
  var PEERS_DIR = path.join(baseDir, "peers");

  /** Entry that represents the local machine's peer.
   * @constant
   * @private
   * @fieldOf Swarm#
   */
  var LOCAL_PEER_ENTRY = "__local__";

  /** Full path to the local machine node's descriptor.
   * @constant
   * @type {String}
   * @private
   * @fieldOf Swarm#
   */
  var LOCAL_PEER_FILE = path.join(PEERS_DIR, LOCAL_PEER_ENTRY);

  /** Point-to-point peer constructor.
   * @type {Function}
   * @private
   * @fieldOf Swarm#
   */
  var Peer = require("./Peer");

  /** Mapping from ids to peers.
   * @type {Object[String => Peer]}
   * @private
   * @fieldOf Swarm#
   */
  var peerMap = {};

  /** Initializes the network map reading all peers from file system
   * descriptors.
   * @private
   * @methodOf Swarm#
   */
  var initialize = (function () {
    var files;

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir);
    }
    if (!fs.existsSync(PEERS_DIR)) {
      fs.mkdirSync(PEERS_DIR);
    }
    if (!fs.existsSync(LOCAL_PEER_FILE)) {
      fs.writeFileSync(LOCAL_PEER_FILE, JSON.stringify({
        address: "localhost",
        port: Math.floor(Math.random() * 12000 + 1024)
      }));
    }
    files = fs.readdirSync(PEERS_DIR);
    files.forEach(function (file) {
      var peerFile = path.join(PEERS_DIR, file);
      var stats = fs.statSync(peerFile);
      var rawPeer;

      if (stats.isFile()) {
        rawPeer = fs.readFileSync(peerFile).toString();
        peerMap[file] = new Peer(JSON.parse(rawPeer));
      }
    });
  }());

  return {
    /** Returns the Peer that represents local machine.
     * @return {Peer} Returns the local machine peer, never null.
     */
    getLocalNode: function (){
      return peerMap[LOCAL_PEER_ENTRY];
    },

    /** Returns the list of existing peers in the network.
     * @return {Peer[]} Returns a list of peers, never null.
     */
    getPeers: function () {
      var peerId;
      var peers = [];

      for (peerId in peerMap) {
        if (peerMap.hasOwnProperty(peerId) && peerId !== LOCAL_PEER_ENTRY) {
          peers.push(peerMap[peerId]);
        }
      }
      return peers;
    },

    /** Updates local machine's peer information.
     * @param {String} address Local machine address. Cannot be null or empty.
     */
    updateLocalNode: function (address) {
      var localNode = peerMap[LOCAL_PEER_ENTRY];
      localNode.address = address;
      fs.writeFileSync(LOCAL_PEER_FILE, JSON.stringify(localNode));
    },

    /** Makes a peer to join this network.
     * @param {Peer} peer Peer to join the network. Cannot be null.
     */
    join: function (peer) {
      var file = path.join(PEERS_DIR, peer.id);

      fs.writeFileSync(file, JSON.stringify(peer));

      if (peerMap.hasOwnProperty(peer.id)) {
        peerMap[peer.id] = peer;
      }
    },

    /** Forces a peer to leave the network.
     * @param {Peer} peer Peer to leave the network. Cannot be null.
     */
    leave: function (peer) {
      var file = path.join(PEERS_DIR, peer.id);

      fs.unlinkSync(file);

      if (peerMap.hasOwnProperty(peer.id)) {
        delete peerMap[peer.id];
      }
    }
  };
};
