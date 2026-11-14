package expo.modules.tablodgecrypto

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteBuffer
import java.text.Normalizer
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * The two operations the private library needs, done natively because 600,000 PBKDF2 rounds are far too slow in
 * JavaScript. The formats follow apps/extension/src/app/crypto-envelope.ts and private-lock.ts.
 */
class TablodgeCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TablodgeCrypto")

    // Opens the credential envelope that wraps the sync key. Returns the key as base64, or null when the
    // credential is wrong (or the envelope was changed, which looks the same).
    AsyncFunction("unwrapKey") { envelopeBase64: String, credential: String ->
      val envelope = Base64.decode(envelopeBase64, Base64.DEFAULT)
      require(envelope.size >= FIXED_HEADER && envelope[0] == 0x54.toByte() && envelope[1] == 0x4c.toByte() &&
        envelope[2] == 0x45.toByte() && envelope[3] == 0x4e.toByte()) { "damaged" }
      require(envelope[4].toInt() == 1 && envelope[5].toInt() == 1) { "unsupported" }
      val iterations = ByteBuffer.wrap(envelope, 6, 4).int
      require(iterations in 1..MAX_ITERATIONS) { "unsupported" }
      val saltLength = envelope[10].toInt() and 0xff
      val ivLength = envelope[11].toInt() and 0xff
      val headerLength = FIXED_HEADER + saltLength + ivLength
      require(saltLength >= 8 && ivLength == 12 && envelope.size >= headerLength + 16) { "damaged" }
      val header = envelope.copyOfRange(0, headerLength)
      val salt = envelope.copyOfRange(FIXED_HEADER, FIXED_HEADER + saltLength)
      val iv = envelope.copyOfRange(FIXED_HEADER + saltLength, headerLength)
      val spec = PBEKeySpec(Normalizer.normalize(credential, Normalizer.Form.NFKC).toCharArray(), salt, iterations, 256)
      val key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
      val plain = decrypt(key, iv, header, envelope.copyOfRange(headerLength, envelope.size))
      plain?.let { Base64.encodeToString(it, Base64.NO_WRAP) }
    }

    // Opens one sealed record value. The record's key name is authenticated data, so a value moved to another
    // record fails. Returns the JSON text, or null when it does not open.
    AsyncFunction("openSealed") { keyBase64: String, ivBase64: String, cipherBase64: String, name: String ->
      val key = Base64.decode(keyBase64, Base64.DEFAULT)
      val iv = Base64.decode(ivBase64, Base64.DEFAULT)
      val data = Base64.decode(cipherBase64, Base64.DEFAULT)
      decrypt(key, iv, name.toByteArray(Charsets.UTF_8), data)?.toString(Charsets.UTF_8)
    }
  }

  private fun decrypt(key: ByteArray, iv: ByteArray, aad: ByteArray, data: ByteArray): ByteArray? =
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
      cipher.updateAAD(aad)
      cipher.doFinal(data)
    } catch (_: Exception) {
      null
    }

  private companion object {
    const val FIXED_HEADER = 12
    const val MAX_ITERATIONS = 20_000_000
  }
}
