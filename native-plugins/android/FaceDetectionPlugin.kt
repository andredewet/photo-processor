package com.photocropper.plugins

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions

@CapacitorPlugin(name = "FaceDetection")
class FaceDetectionPlugin : Plugin() {

    private var detector: FaceDetector? = null

    @PluginMethod
    fun initialize(call: PluginCall) {
        try {
            val options = FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
                .setMinFaceSize(0.15f)
                .build()

            detector = FaceDetection.getClient(options)
            
            val result = JSObject()
            result.put("success", true)
            call.resolve(result)
        } catch (e: Exception) {
            val result = JSObject()
            result.put("success", false)
            call.resolve(result)
        }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val result = JSObject()
        result.put("available", true)
        result.put("platform", "android")
        call.resolve(result)
    }

    @PluginMethod
    fun dispose(call: PluginCall) {
        detector?.close()
        detector = null
        call.resolve()
    }

    @PluginMethod
    fun detectFace(call: PluginCall) {
        val imageData = call.getString("imageData")
        if (imageData == null) {
            call.reject("Missing imageData parameter")
            return
        }

        val ovalBoundsObj = call.getObject("ovalBounds")
        if (ovalBoundsObj == null) {
            call.reject("Missing ovalBounds parameter")
            return
        }

        val ovalBounds = OvalBounds(
            centerX = ovalBoundsObj.getDouble("centerX"),
            centerY = ovalBoundsObj.getDouble("centerY"),
            radiusX = ovalBoundsObj.getDouble("radiusX"),
            radiusY = ovalBoundsObj.getDouble("radiusY")
        )

        val bitmap = decodeBase64Image(imageData)
        if (bitmap == null) {
            call.reject("Failed to decode image")
            return
        }

        // Initialize detector if needed
        if (detector == null) {
            val options = FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setMinFaceSize(0.15f)
                .build()
            detector = FaceDetection.getClient(options)
        }

        val inputImage = InputImage.fromBitmap(bitmap, 0)

        detector?.process(inputImage)
            ?.addOnSuccessListener { faces ->
                val result = processFaces(faces, bitmap.width, bitmap.height, ovalBounds)
                bitmap.recycle()
                call.resolve(result)
            }
            ?.addOnFailureListener { e ->
                bitmap.recycle()
                val result = JSObject()
                result.put("faceDetected", false)
                result.put("guidance", "no_face")
                call.resolve(result)
            }
    }

    private fun processFaces(faces: List<Face>, imageWidth: Int, imageHeight: Int, ovalBounds: OvalBounds): JSObject {
        val result = JSObject()

        if (faces.isEmpty()) {
            result.put("faceDetected", false)
            result.put("guidance", "no_face")
            return result
        }

        if (faces.size > 1) {
            result.put("faceDetected", true)
            result.put("guidance", "multiple_faces")
            return result
        }

        val face = faces[0]
        val boundingBox = face.boundingBox

        // Normalize bounds to 0-1 range
        val bounds = JSObject()
        bounds.put("x", boundingBox.left.toDouble() / imageWidth)
        bounds.put("y", boundingBox.top.toDouble() / imageHeight)
        bounds.put("width", boundingBox.width().toDouble() / imageWidth)
        bounds.put("height", boundingBox.height().toDouble() / imageHeight)

        val guidance = calculateGuidance(
            faceX = bounds.getDouble("x"),
            faceY = bounds.getDouble("y"),
            faceWidth = bounds.getDouble("width"),
            faceHeight = bounds.getDouble("height"),
            ovalBounds = ovalBounds
        )

        result.put("faceDetected", true)
        result.put("bounds", bounds)
        result.put("guidance", guidance)
        result.put("confidence", 0.9) // ML Kit doesn't provide confidence for bounding box

        return result
    }

    private fun calculateGuidance(
        faceX: Double,
        faceY: Double,
        faceWidth: Double,
        faceHeight: Double,
        ovalBounds: OvalBounds
    ): String {
        val faceCenterX = faceX + faceWidth / 2
        val faceCenterY = faceY + faceHeight / 2

        val positionThreshold = 0.08
        val faceSize = maxOf(faceWidth, faceHeight)
        val ovalSize = maxOf(ovalBounds.radiusX * 2, ovalBounds.radiusY * 2)
        val sizeRatio = faceSize / ovalSize

        // Too small = move closer
        if (sizeRatio < 0.5) {
            return "move_closer"
        }

        // Too large = move back
        if (sizeRatio > 1.1) {
            return "move_back"
        }

        // Check horizontal position
        val xOffset = faceCenterX - ovalBounds.centerX
        if (xOffset < -positionThreshold) {
            return "move_right"
        }
        if (xOffset > positionThreshold) {
            return "move_left"
        }

        // Check vertical position
        val yOffset = faceCenterY - ovalBounds.centerY
        if (yOffset < -positionThreshold) {
            return "move_down"
        }
        if (yOffset > positionThreshold) {
            return "move_up"
        }

        return "hold_still"
    }

    private fun decodeBase64Image(dataUrl: String): Bitmap? {
        return try {
            val base64String = if (dataUrl.contains(",")) {
                dataUrl.substringAfter(",")
            } else {
                dataUrl
            }
            val bytes = Base64.decode(base64String, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (e: Exception) {
            null
        }
    }

    private data class OvalBounds(
        val centerX: Double,
        val centerY: Double,
        val radiusX: Double,
        val radiusY: Double
    )
}

