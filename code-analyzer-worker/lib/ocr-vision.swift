import Foundation
import Vision
import AppKit

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
guard !path.isEmpty,
      let image = NSImage(contentsOfFile: path),
      let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let cg = rep.cgImage else {
  fputs("ocr input unreadable\n", stderr)
  exit(2)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([request])

for observation in request.results ?? [] {
  guard let candidate = observation.topCandidates(1).first else { continue }
  let box = observation.boundingBox
  let payload: [String: Any] = [
    "text": candidate.string,
    "confidence": candidate.confidence,
    "x": box.origin.x,
    "y": box.origin.y,
    "width": box.size.width,
    "height": box.size.height,
    "origin": "bottom-left",
  ]
  let data = try JSONSerialization.data(withJSONObject: payload)
  if let line = String(data: data, encoding: .utf8) {
    print(line)
  }
}
