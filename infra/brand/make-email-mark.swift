// Renders the CareNest email mark: the app icon on a white rounded chip, at
// 192x192 (3x the 64px display size used in the email header).
//
// Why the chip: the icon is a dark teal tile (#1F637A) and the email header is
// #1A3BA0 — about 1.4:1 contrast, so the tile would blend into the header. A
// white rounded chip separates them without changing the header colour.
//
// Usage (from the backend repo root):
//   swift infra/brand/make-email-mark.swift [source-icon] [output-png]
//
// Defaults: ../assets/icons/ic_launcher_foreground_clean.png  (frontend app icon)
//           assets/brand/carenest-mark.png
//
// macOS-only, no third-party dependencies (CoreGraphics + ImageIO).

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let repoRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let srcPath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : repoRoot.appendingPathComponent("../assets/icons/ic_launcher_foreground_clean.png").path
let outPath = CommandLine.arguments.count > 2
    ? CommandLine.arguments[2]
    : repoRoot.appendingPathComponent("assets/brand/carenest-mark.png").path

guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: srcPath) as CFURL, nil),
      let icon = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    fatalError("cannot read source icon at \(srcPath)")
}

// Geometry, all in 192px space.
let px = 192
let inset: CGFloat = 12          // white ring: 4px at the 64px display size
let outerRadius: CGFloat = 44    // ~23% of 192px, matches the icon's own ~19.5%
let innerSize = CGFloat(px) - inset * 2
let innerRadius = outerRadius - inset * 0.85

func roundedRect(_ rect: CGRect, _ radius: CGFloat) -> CGPath {
    CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8,
                          bytesPerRow: 0, space: colorSpace,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("cannot create bitmap context")
}
ctx.interpolationQuality = .high
ctx.clear(CGRect(x: 0, y: 0, width: CGFloat(px), height: CGFloat(px)))

// 1. White chip.
ctx.saveGState()
ctx.addPath(roundedRect(CGRect(x: 0, y: 0, width: CGFloat(px), height: CGFloat(px)), outerRadius))
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
ctx.fillPath()
ctx.restoreGState()

// 2. Icon, clipped to its own rounded rect so the icon's transparent corners
//    reveal the chip instead of the blue header behind it.
ctx.saveGState()
ctx.addPath(roundedRect(CGRect(x: inset, y: inset, width: innerSize, height: innerSize), innerRadius))
ctx.clip()
ctx.draw(icon, in: CGRect(x: inset, y: inset, width: innerSize, height: innerSize))
ctx.restoreGState()

guard let mark = ctx.makeImage() else { fatalError("cannot render mark") }
guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL,
                                                UTType.png.identifier as CFString, 1, nil) else {
    fatalError("cannot write \(outPath)")
}
CGImageDestinationAddImage(dest, mark, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("cannot finalize \(outPath)") }

print("wrote \(outPath) (\(px)x\(px))")
