import Foundation
import Capacitor
import Vision
import CoreImage
import UIKit

@objc(BackgroundRemovalPlugin)
public class BackgroundRemovalPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BackgroundRemovalPlugin"
    public let jsName = "BackgroundRemoval"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "removeBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise)
    ]
    
    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": true,
            "platform": "ios"
        ])
    }
    
    @objc func removeBackground(_ call: CAPPluginCall) {
        guard let imageData = call.getString("imageData") else {
            call.reject("Missing imageData parameter")
            return
        }
        
        let useEllipticalMask = call.getBool("useEllipticalMask") ?? true
        
        // Parse base64 data URL
        guard let image = imageFromDataUrl(imageData) else {
            call.reject("Failed to decode image data")
            return
        }
        
        // Perform face detection and masking on background thread
        DispatchQueue.global(qos: .userInitiated).async {
            self.processImage(image: image, useEllipticalMask: useEllipticalMask) { result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let (processedImage, faceDetected)):
                        if let dataUrl = self.imageToDataUrl(processedImage) {
                            call.resolve([
                                "dataUrl": dataUrl,
                                "faceDetected": faceDetected
                            ])
                        } else {
                            call.reject("Failed to encode result image")
                        }
                    case .failure(let error):
                        call.reject(error.localizedDescription)
                    }
                }
            }
        }
    }
    
    private func processImage(image: UIImage, useEllipticalMask: Bool, completion: @escaping (Result<(UIImage, Bool), Error>) -> Void) {
        guard let cgImage = image.cgImage else {
            completion(.failure(NSError(domain: "BackgroundRemoval", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to get CGImage"])))
            return
        }
        
        // Create Vision request for face detection
        let faceRequest = VNDetectFaceRectanglesRequest { request, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let observations = request.results as? [VNFaceObservation],
                  let faceObservation = observations.first else {
                // No face detected - apply center elliptical mask
                if let result = self.applyEllipticalMask(to: image, faceRect: nil) {
                    completion(.success((result, false)))
                } else {
                    completion(.failure(NSError(domain: "BackgroundRemoval", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to apply mask"])))
                }
                return
            }
            
            // Face detected - apply mask around face
            let imageSize = CGSize(width: cgImage.width, height: cgImage.height)
            let faceRect = self.convertFaceRect(faceObservation.boundingBox, imageSize: imageSize)
            
            if let result = self.applyEllipticalMask(to: image, faceRect: faceRect) {
                completion(.success((result, true)))
            } else {
                completion(.failure(NSError(domain: "BackgroundRemoval", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to apply face mask"])))
            }
        }
        
        // Perform face detection
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([faceRequest])
        } catch {
            completion(.failure(error))
        }
    }
    
    private func convertFaceRect(_ normalizedRect: CGRect, imageSize: CGSize) -> CGRect {
        // Vision uses normalized coordinates (0-1) with origin at bottom-left
        // Convert to UIKit coordinates with origin at top-left
        let x = normalizedRect.origin.x * imageSize.width
        let y = (1 - normalizedRect.origin.y - normalizedRect.height) * imageSize.height
        let width = normalizedRect.width * imageSize.width
        let height = normalizedRect.height * imageSize.height
        
        return CGRect(x: x, y: y, width: width, height: height)
    }
    
    private func applyEllipticalMask(to image: UIImage, faceRect: CGRect?) -> UIImage? {
        let size = image.size
        let minDim = min(size.width, size.height)
        
        // Calculate ellipse parameters
        let ellipseCenter: CGPoint
        let ellipseRadiusX: CGFloat
        let ellipseRadiusY: CGFloat
        
        if let face = faceRect {
            // Expand face rect to include head/hair
            let expandedWidth = face.width * 1.8
            let expandedHeight = face.height * 2.2
            
            ellipseCenter = CGPoint(
                x: face.midX,
                y: face.midY - face.height * 0.1 // Shift up slightly
            )
            ellipseRadiusX = expandedWidth / 2
            ellipseRadiusY = expandedHeight / 2
        } else {
            // Default to center ellipse
            ellipseCenter = CGPoint(x: size.width / 2, y: size.height / 2)
            ellipseRadiusX = minDim * 0.4
            ellipseRadiusY = minDim * 0.5
        }
        
        // Create the masked image
        UIGraphicsBeginImageContextWithOptions(size, true, image.scale)
        guard let context = UIGraphicsGetCurrentContext() else {
            UIGraphicsEndImageContext()
            return nil
        }
        
        // Fill with white background
        context.setFillColor(UIColor.white.cgColor)
        context.fill(CGRect(origin: .zero, size: size))
        
        // Create elliptical clipping path
        let ellipsePath = UIBezierPath(ovalIn: CGRect(
            x: ellipseCenter.x - ellipseRadiusX,
            y: ellipseCenter.y - ellipseRadiusY,
            width: ellipseRadiusX * 2,
            height: ellipseRadiusY * 2
        ))
        
        // Apply soft edge (feathering) using gradient mask
        context.saveGState()
        ellipsePath.addClip()
        
        // Draw the original image
        image.draw(at: .zero)
        
        context.restoreGState()
        
        let result = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        
        return result
    }
    
    private func imageFromDataUrl(_ dataUrl: String) -> UIImage? {
        // Remove data URL prefix if present
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
    
    private func imageToDataUrl(_ image: UIImage) -> String? {
        guard let data = image.pngData() else {
            return nil
        }
        return "data:image/png;base64," + data.base64EncodedString()
    }
}

