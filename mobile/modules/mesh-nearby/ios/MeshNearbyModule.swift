import ExpoModulesCore
import MultipeerConnectivity

/**
 * MultipeerConnectivity: Bluetooth + peer-to-peer Wi-Fi between iPhones, no internet or router needed.
 * iOS suspends this when the app is in the background, so iPhones relay while the app is open
 * (Android phones can keep relaying in the background).
 */
public class MeshNearbyModule: Module {
  private var mesh: MultipeerMesh?

  public func definition() -> ModuleDefinition {
    Name("MeshNearby")
    Events("onPeer", "onPeerLost", "onPayload")

    Function("isAvailable") { true }

    AsyncFunction("start") { (_ serviceId: String, localName: String) in
      self.mesh?.stop()
      let m = MultipeerMesh(localName: localName)
      m.onPeer = { [weak self] id, name in self?.sendEvent("onPeer", ["endpointId": id, "name": name]) }
      m.onPeerLost = { [weak self] id, name in self?.sendEvent("onPeerLost", ["endpointId": id, "name": name]) }
      m.onPayload = { [weak self] id, data in self?.sendEvent("onPayload", ["endpointId": id, "data": data.base64EncodedString()]) }
      m.start()
      self.mesh = m
    }

    Function("stop") {
      self.mesh?.stop()
      self.mesh = nil
    }

    AsyncFunction("send") { (endpointId: String, base64: String) in
      guard let data = Data(base64Encoded: base64) else { return }
      try self.mesh?.send(data, to: endpointId)
    }

    Function("setBackground") { (_ enabled: Bool, _ title: String, _ text: String) in
      // Not available on iOS: the system stops peer-to-peer networking in the background.
    }
  }
}

final class MultipeerMesh: NSObject, MCSessionDelegate, MCNearbyServiceAdvertiserDelegate, MCNearbyServiceBrowserDelegate {
  private let serviceType = "sos-mesh"
  private let me: MCPeerID
  private let session: MCSession
  private let advertiser: MCNearbyServiceAdvertiser
  private let browser: MCNearbyServiceBrowser
  private var peers: [String: MCPeerID] = [:]
  private let lock = NSLock()

  var onPeer: ((String, String) -> Void)?
  var onPeerLost: ((String, String) -> Void)?
  var onPayload: ((String, Data) -> Void)?

  init(localName: String) {
    me = MCPeerID(displayName: String(localName.prefix(60)))
    session = MCSession(peer: me, securityIdentity: nil, encryptionPreference: .required)
    advertiser = MCNearbyServiceAdvertiser(peer: me, discoveryInfo: nil, serviceType: serviceType)
    browser = MCNearbyServiceBrowser(peer: me, serviceType: serviceType)
    super.init()
    session.delegate = self
    advertiser.delegate = self
    browser.delegate = self
  }

  func start() {
    advertiser.startAdvertisingPeer()
    browser.startBrowsingForPeers()
  }

  func stop() {
    advertiser.stopAdvertisingPeer()
    browser.stopBrowsingForPeers()
    session.disconnect()
    lock.lock(); peers.removeAll(); lock.unlock()
  }

  func send(_ data: Data, to endpointId: String) throws {
    lock.lock(); let peer = peers[endpointId]; lock.unlock()
    guard let p = peer else { return }
    try session.send(data, toPeers: [p], with: .reliable)
  }

  private func key(_ p: MCPeerID) -> String { "\(p.displayName)#\(p.hash)" }

  func browser(_ browser: MCNearbyServiceBrowser, foundPeer peer: MCPeerID, withDiscoveryInfo info: [String: String]?) {
    // Only one side invites, avoiding duplicate sessions.
    if me.displayName < peer.displayName { browser.invitePeer(peer, to: session, withContext: nil, timeout: 20) }
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peer: MCPeerID) {}

  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peer: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
    // Trust is checked one layer up with platform-signed device certificates.
    invitationHandler(true, session)
  }

  func session(_ session: MCSession, peer: MCPeerID, didChange state: MCSessionState) {
    let k = key(peer)
    switch state {
    case .connected:
      lock.lock(); peers[k] = peer; lock.unlock()
      onPeer?(k, peer.displayName)
    case .notConnected:
      lock.lock(); peers.removeValue(forKey: k); lock.unlock()
      onPeerLost?(k, peer.displayName)
    default:
      break
    }
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peer: MCPeerID) {
    onPayload?(key(peer), data)
  }

  func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
  func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
  func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}
