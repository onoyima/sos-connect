package ng.sosconnect.meshnearby

import android.content.Intent
import android.os.Build
import android.util.Base64
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Nearby Connections with the P2P_CLUSTER strategy: every phone advertises and discovers at the same time,
 * forming a many-to-many cluster over Bluetooth / BLE / Wi-Fi Direct / hotspot (chosen by Play Services).
 * Connections are accepted without a PIN: trust is established one layer up by device certificates
 * signed by the platform, which every envelope carries.
 */
class MeshNearbyModule : Module() {
  private val strategy = Strategy.P2P_CLUSTER
  private var serviceId = "ng.sosconnect.mesh"
  private var localName = "sos"
  private val connected = mutableMapOf<String, String>()   // endpointId -> name
  private val pending = mutableSetOf<String>()

  private val client by lazy { Nearby.getConnectionsClient(appContext.reactContext!!) }

  override fun definition() = ModuleDefinition {
    Name("MeshNearby")
    Events("onPeer", "onPeerLost", "onPayload")

    Function("isAvailable") { appContext.reactContext != null }

    AsyncFunction("start") { id: String, name: String, promise: Promise ->
      serviceId = id
      localName = name
      val adv = AdvertisingOptions.Builder().setStrategy(strategy).build()
      val disc = DiscoveryOptions.Builder().setStrategy(strategy).build()
      client.startAdvertising(localName, serviceId, lifecycle, adv)
        .addOnFailureListener { /* already advertising is fine */ }
      client.startDiscovery(serviceId, discovery, disc)
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { e -> promise.reject("E_DISCOVERY", e.message ?: "discovery failed", e) }
    }

    Function("stop") {
      client.stopAdvertising()
      client.stopDiscovery()
      client.stopAllEndpoints()
      connected.clear()
      pending.clear()
    }

    AsyncFunction("send") { endpointId: String, base64: String, promise: Promise ->
      val bytes = Base64.decode(base64, Base64.NO_WRAP)
      if (bytes.size > ConnectionsClient.MAX_BYTES_DATA_SIZE) {
        promise.reject("E_TOO_BIG", "Payload exceeds ${ConnectionsClient.MAX_BYTES_DATA_SIZE} bytes", null)
        return@AsyncFunction
      }
      client.sendPayload(endpointId, Payload.fromBytes(bytes))
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { e -> promise.reject("E_SEND", e.message ?: "send failed", e) }
    }

    Function("setBackground") { enabled: Boolean, title: String, text: String ->
      val ctx = appContext.reactContext ?: return@Function
      val intent = Intent(ctx, MeshForegroundService::class.java)
        .putExtra("title", title).putExtra("text", text)
      if (enabled) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
      } else {
        ctx.stopService(intent)
      }
    }
  }

  private val discovery = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      if (connected.containsKey(endpointId) || pending.contains(endpointId)) return
      // Only one side asks, which avoids simultaneous-request collisions.
      if (localName < info.endpointName) {
        pending.add(endpointId)
        client.requestConnection(localName, endpointId, lifecycle).addOnFailureListener { pending.remove(endpointId) }
      }
    }

    override fun onEndpointLost(endpointId: String) {
      pending.remove(endpointId)
    }
  }

  private val lifecycle = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
      pending.add(endpointId)
      connected[endpointId] = info.endpointName
      client.acceptConnection(endpointId, payloads)
    }

    override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
      pending.remove(endpointId)
      if (result.status.isSuccess) {
        sendEvent("onPeer", mapOf("endpointId" to endpointId, "name" to (connected[endpointId] ?: "")))
      } else {
        connected.remove(endpointId)
      }
    }

    override fun onDisconnected(endpointId: String) {
      val name = connected.remove(endpointId) ?: ""
      sendEvent("onPeerLost", mapOf("endpointId" to endpointId, "name" to name))
    }
  }

  private val payloads = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      val bytes = payload.asBytes() ?: return
      sendEvent("onPayload", mapOf("endpointId" to endpointId, "data" to Base64.encodeToString(bytes, Base64.NO_WRAP)))
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
  }
}
