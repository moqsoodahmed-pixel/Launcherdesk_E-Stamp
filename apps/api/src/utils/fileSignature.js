"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExecutableSignature = void 0;
// Phase 19 - upload MIME allowlists (file.service.js, bulk-estamp.service.js)
// only ever check the client-declared `mimetype` (the multipart part's own
// Content-Type header) - a value the uploading client fully controls and can
// lie about. Renaming `virus.exe` to `virus.pdf` and declaring
// `Content-Type: application/pdf` would otherwise sail through the allowlist
// untouched. This module adds a narrow, additive DENYLIST check against the
// actual file bytes: known executable/script magic numbers are rejected
// regardless of what Content-Type was declared. It deliberately does NOT
// attempt to positively verify that, say, a "application/pdf" upload
// actually starts with a real `%PDF-` header - several existing, legitimate
// test fixtures (and potentially real-world lightly-malformed but harmless
// uploads) use placeholder/non-standard bytes for allowed types, and this
// business flow never parses the file as its claimed format anyway (it is
// stored as opaque, checksummed bytes). Blocking known-executable signatures
// closes the concrete "renamed executable" bypass without changing any
// existing accepted-upload behavior.
const EXECUTABLE_SIGNATURES = [
    Buffer.from([0x4d, 0x5a]), // "MZ" - Windows PE/DOS executable
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // "\x7fELF" - Linux ELF executable
    Buffer.from([0xfe, 0xed, 0xfa, 0xce]), // Mach-O 32-bit
    Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), // Mach-O 64-bit
    Buffer.from([0xce, 0xfa, 0xed, 0xfe]), // Mach-O 32-bit (reverse byte order)
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), // Mach-O 64-bit (reverse byte order)
    Buffer.from("#!", "ascii"), // shebang script (sh/bash/python/perl/etc.)
    Buffer.from("MZ", "ascii"), // defensive duplicate in case of encoding mismatch above
];
function isExecutableSignature(buffer) {
    if (!buffer || buffer.length === 0)
        return false;
    return EXECUTABLE_SIGNATURES.some((sig) => buffer.length >= sig.length && buffer.subarray(0, sig.length).equals(sig));
}
exports.isExecutableSignature = isExecutableSignature;
