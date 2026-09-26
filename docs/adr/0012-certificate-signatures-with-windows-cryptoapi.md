# Check PDF certificate signatures with the Windows CryptoAPI and certificate store

People on Windows regularly receive PDFs signed with Adobe Acrobat or DocuSign. Glance shows whether each signature holds up: the signed bytes are unchanged, who signed and when, and whether the signer's certificate chains to an authority the user's Windows trusts.

The UI finds signature fields with pdf-lib and hands each CMS blob, with the bytes its `/ByteRange` covers, to Rust. Rust checks it with CryptoAPI (`CryptVerifyDetachedMessageSignature`, `CryptVerifyTimeStampSignature`) and builds the chain with `CertGetCertificateChain`, including revocation checks with a timeout. Trust therefore matches what Windows applies to signed programs and email, including enterprise roots pushed by group policy, and nothing is bundled. The trade-off: Adobe's own trust list (AATL) isn't consulted, so a signature Acrobat trusts only through AATL shows here as "signer not verified" while still reporting the document as unchanged. Checks only run in the Windows app.

Glance also checks that each `/ByteRange` leaves out exactly the signature value, so a signature can't vouch for part of a file while other content hides in the gap. It reports changes appended after a signature separately from later signatures.

Compacting a PDF (dropping earlier revisions) would break every signature, so signed PDFs are never compacted on save. Saving markup still rewrites the file; the banner warns about that before saving.
