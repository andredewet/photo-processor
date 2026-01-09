import Foundation
import Capacitor
import Vision
import UIKit

@objc(FaceDetectionPlugin)
public class FaceDetectionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FaceDetectionPlugin"
    public let jsName = "FaceDetection"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "detectFace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dispose", returnType: CAPPluginReturnPromise)
    ]
    
    private var isInitialized = false
    
    @objc func initialize(_ call: CAPPluginCall) {
        // Vision framework is always available on iOS 11+
        isInitialized = true
        call.resolve(["success": true])
    }
    
    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": true,
            "platform": "ios"
        ])
    }
    
    @objc func dispose(_ call: CAPPluginCall) {
        isInitialized = false
        call.resolve()
    }
    
    @objc func detectFace(_ call: CAPPluginCall) {
        guard let imageData = call.getString("imageData") else {
            call.reject("Missing imageData parameter")
            return
        }
        
        guard let ovalBoundsObj = call.getObject("ovalBounds"),
              let centerX = ovalBoundsObj["centerX"] as? Double,
              let centerY = ovalBoundsObj["centerY"] as? Double,
              let radiusX = ovalBoundsObj["radiusX"] as? Double,
              let radiusY = ovalBoundsObj["radiusY"] as? Double else {
            call.reject("Missing or invalid ovalBounds parameter")
            return
        }
        
        let ovalBounds = OvalBounds(centerX: centerX, centerY: centerY, radiusX: radiusX, radiusY: radiusY)
        
        guard let image = imageFromDataUrl(imageData),
              let cgImage = image.cgImage else {
            call.reject("Failed to decode image")
            return
        }
        
        // Perform face detection on background thread
        DispatchQueue.global(qos: .userInteractive).async {
            self.performFaceDetection(cgImage: cgImage, ovalBounds: ovalBounds) { result in
                DispatchQueue.main.async {
                    call.resolve(result)
                }
            }
        }
    }
    
    private func performFaceDetection(cgImage: CGImage, ovalBounds: OvalBounds, completion: @escaping ([String: Any]) -> Void) {
        let request = VNDetectFaceRectanglesRequest { request, error in
            if let error = error {
                print("Face detection error: \(error)")
                completion([
                    "faceDetected": false,
                    "guidance": "no_face"
                ])
                return
            }
            
            guard let observations = request.results as? [VNFaceObservation] else {
                completion([
                    "faceDetected": false,
                    "guidance": "no_face"
                ])
                return
            }
            
            if observations.isEmpty {
                completion([
                    "faceDetected": false,
                    "guidance": "no_face"
                ])
                return
            }
            
            if observations.count > 1 {
                completion([
                    "faceDetected": true,
                    "guidance": "multiple_faces"
                ])
                return
            }
            
            let face = observations[0]
            
            // Vision uses normalized coordinates (0-1) with origin at bottom-left
            // Convert to top-left origin
            let bounds: [String: Double] = [
                "x": Double(face.boundingBox.origin.x),
                "y": Double(1.0 - face.boundingBox.origin.y - face.boundingBox.height),
                "width": Double(face.boundingBox.width),
                "height": Double(face.boundingBox.height)
            ]
            
            let guidance = self.calculateGuidance(
                faceX: bounds["x"]!,
                faceY: bounds["y"]!,
                faceWidth: bounds["width"]!,
                faceHeight: bounds["height"]!,
                ovalBounds: ovalBounds
            )
            
            completion([
                "faceDetected": true,
                "bounds": bounds,
                "guidance": guidance,
                "confidence": Double(face.confidence)
            ])
        }
        
        // Use accurate mode for better detection
        request.revision = VNDetectFaceRectanglesRequestRevision3
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
        } catch {
            print("Failed to perform face detection: \(error)")
            completion([
                "faceDetected": false,
                "guidance": "no_face"
            ])
        }
    }
    
    private func calculateGuidance(faceX: Double, faceY: Double, faceWidth: Double, faceHeight: Double, ovalBounds: OvalBounds) -> String {
        let faceCenterX = faceX + faceWidth / 2
        let faceCenterY = faceY + faceHeight / 2
        
        let positionThreshold = 0.08
        let faceSize = max(faceWidth, faceHeight)
        let ovalSize = max(ovalBounds.radiusX * 2, ovalBounds.radiusY * 2)
        let sizeRatio = faceSize / ovalSize
        
        // Too small = move closer
        if sizeRatio < 0.5 {
            return "move_closer"
        }
        
        // Too large = move back
        if sizeRatio > 1.1 {
            return "move_back"
        }
        
        // Check horizontal position
        let xOffset = faceCenterX - ovalBounds.centerX
        if xOffset < -positionThreshold {
            return "move_right"
        }
        if xOffset > positionThreshold {
            return "move_left"
        }
        
        // Check vertical position
        let yOffset = faceCenterY - ovalBounds.centerY
        if yOffset < -positionThreshold {
            return "move_down"
        }
        if yOffset > positionThreshold {
            return "move_up"
        }
        
        return "hold_still"
    }
    
    private func imageFromDataUrl(_ dataUrl: String) -> UIImage? {
        let base64String: String
        if dataUrl.contains(",") {
            base64String = String(dataUrl.split(separator: ",").last ?? "")
        } else {
            base64String = dataUrl
        }
        
        guard let data = Data(base64Encoded: base64String) else {
            return nil
        }
        
        return UIImage(data: data)
    }
}

private struct OvalBounds {
    let centerX: Double
    let centerY: Double
    let radiusX: Double
    let radiusY: Double
}

