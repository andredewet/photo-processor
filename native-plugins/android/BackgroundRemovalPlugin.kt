package com.photocropper.plugins

import android.graphics.*
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.SegmentationMask
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

@CapacitorPlugin(name = "BackgroundRemoval")
class BackgroundRemovalPlugin : Plugin() {

    private val segmenter by lazy {
        val options = SelfieSegmenterOptions.Builder()
            .setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE)
            .enableRawSizeMask()
            .build()
        Segmentation.getClient(options)
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val result = JSObject()
        result.put("available", true)
        result.put("platform", "android")
        call.resolve(result)
    }

    @PluginMethod
    fun removeBackground(call: PluginCall) {
        val imageData = call.getString("imageData")
        if (imageData == null) {
            call.reject("Missing imageData parameter")
            return
        }

        try {
            val bitmap = decodeBase64Image(imageData)
            if (bitmap == null) {
                call.reject("Failed to decode image data")
                return
            }

            val inputImage = InputImage.fromBitmap(bitmap, 0)

            segmenter.process(inputImage)
                .addOnSuccessListener { segmentationMask ->
                    val resultBitmap = applyMask(bitmap, segmentationMask)
                    val dataUrl = encodeToDataUrl(resultBitmap)
                    
                    val result = JSObject()
                    result.put("dataUrl", dataUrl)
                    result.put("faceDetected", true)
                    call.resolve(result)
                    
                    // Clean up
                    if (resultBitmap != bitmap) {
                        resultBitmap.recycle()
                    }
                    bitmap.recycle()
                }
                .addOnFailureListener { e ->
                    // Fallback to elliptical mask if ML Kit fails
                    val resultBitmap = applyEllipticalMask(bitmap)
                    val dataUrl = encodeToDataUrl(resultBitmap)
                    
                    val result = JSObject()
                    result.put("dataUrl", dataUrl)
                    result.put("faceDetected", false)
                    call.resolve(result)
                    
                    if (resultBitmap != bitmap) {
                        resultBitmap.recycle()
                    }
                    bitmap.recycle()
                }
        } catch (e: Exception) {
            call.reject("Error processing image: ${e.message}")
        }
    }

    private fun applyMask(original: Bitmap, mask: SegmentationMask): Bitmap {
        val width = original.width
        val height = original.height
        
        val result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(result)
        
        // Fill with white background
        canvas.drawColor(Color.WHITE)
        
        // Get mask buffer and dimensions
        val maskBuffer = mask.buffer
        val maskWidth = mask.width
        val maskHeight = mask.height
        
        // Create a bitmap from the mask
        val maskBitmap = Bitmap.createBitmap(maskWidth, maskHeight, Bitmap.Config.ARGB_8888)
        maskBuffer.rewind()
        
        val maskPixels = IntArray(maskWidth * maskHeight)
        for (i in maskPixels.indices) {
            val confidence = maskBuffer.float
            // Apply threshold and create alpha mask
            val alpha = if (confidence > 0.5f) 255 else 0
            maskPixels[i] = Color.argb(alpha, 255, 255, 255)
        }
        maskBitmap.setPixels(maskPixels, 0, maskWidth, 0, 0, maskWidth, maskHeight)
        
        // Scale mask to match original image size
        val scaledMask = Bitmap.createScaledBitmap(maskBitmap, width, height, true)
        maskBitmap.recycle()
        
        // Apply mask to original image
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        
        // Draw original image
        canvas.drawBitmap(original, 0f, 0f, null)
        
        // Apply mask using PorterDuff
        paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
        canvas.drawBitmap(scaledMask, 0f, 0f, paint)
        
        scaledMask.recycle()
        
        // Composite over white background
        val finalResult = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val finalCanvas = Canvas(finalResult)
        finalCanvas.drawColor(Color.WHITE)
        finalCanvas.drawBitmap(result, 0f, 0f, null)
        
        result.recycle()
        
        return finalResult
    }

    private fun applyEllipticalMask(original: Bitmap): Bitmap {
        val width = original.width
        val height = original.height
        val minDim = minOf(width, height)
        
        val result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(result)
        
        // Fill with white
        canvas.drawColor(Color.WHITE)
        
        // Create elliptical path
        val path = Path()
        val centerX = width / 2f
        val centerY = height / 2f
        val radiusX = minDim * 0.45f
        val radiusY = minDim * 0.55f
        
        path.addOval(
            centerX - radiusX,
            centerY - radiusY,
            centerX + radiusX,
            centerY + radiusY,
            Path.Direction.CW
        )
        
        // Clip to ellipse and draw image
        canvas.save()
        canvas.clipPath(path)
        canvas.drawBitmap(original, 0f, 0f, null)
        canvas.restore()
        
        return result
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

    private fun encodeToDataUrl(bitmap: Bitmap): String {
        val outputStream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
        val bytes = outputStream.toByteArray()
        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return "data:image/png;base64,$base64"
    }
}

