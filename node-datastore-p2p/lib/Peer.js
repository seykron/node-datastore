/** Creates a peer from its raw information, or initializes the node for the
 * local machine if no rawPeer is provided.
 * @param {Object} rawPeer Object containing node information. Can be null.
 * @constructor
 */
module.exports = function Peer (rawPeer) {

  /** Util to extend objects.
   * @type {Function}
   * @private
   * @fieldOf Peer#
   */
  var extend = require("extend");

  /** Util to generate UUIDs.
   * @type {Object}
   * @private
   * @fieldOf Peer#
   */
  var uuid = require("node-uuid");

  /** Current peer object.
   * @type {Object}
   * @private
   * @fieldOf Peer#
   */
  var peer = rawPeer || {};

  return extend(peer, {

    /** Peer unique id, it's never null.
     * @type {String}
     */
    id: peer.id || uuid.v4(),

    /** Enclosing protocol. Default is http.
     * @type {String}
     */
    protocol: peer.protocol || "http",

    /** Peer listening port, it's never null.
     * @type {Number}
     */
    port: peer.port || Math.floor(Math.random() * 12000 + 1024),

    /** Indicates whether this is a master node or not. Master nodes keep track
     * of peers in order to resolve dynamic addresses as the second lookup
     * strategy. Usually someone in a peer network must act as root node to make
     * dynamic addresses work for peers.
     *
     * @type Boolean
     */
    master: peer.master || false,

    /** Peer ip address, it's never null after peer is ready.
     * @type {String}
     */
    address: peer.address || null
  });
};
