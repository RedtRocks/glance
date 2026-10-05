/**
 * The landing page for each file type (see build-format-pages.mjs). Every claim
 * here must be true of both the browser version and the Windows app.
 */
const YELLOW = '#f8d32c'
const PINK = '#f258a8'
const ORANGE = '#f47933'
const VIOLET = '#6312f6'

export const FORMAT_PAGES = [
  {
    slug: 'heic-viewer',
    name: 'HEIC',
    title: 'HEIC Viewer',
    pageTitle: 'Open HEIC Files Online: Free, Private HEIC Viewer | Glance',
    h1: 'Open HEIC Photos Online, Free and Private',
    description: 'View iPhone HEIC and HEIF photos in your browser or on Windows, and save them as JPEG or PNG. Free, works offline, and nothing is uploaded.',
    lead: 'View the HEIC photos your iPhone takes on any phone or computer, and save them as JPEG or PNG. Glance opens them on your device, so nothing is uploaded.',
    exts: ['heic', 'heif', 'hif'],
    tones: [YELLOW, PINK],
    shotAlt: 'A HEIC photo of an espresso cup open in Glance',
    stepThree: ['View, mark up or convert', 'Zoom in, rotate, adjust colour or add markup, then save it as JPEG or PNG with Export As.'],
    can: [
      ['Convert HEIC to JPEG', 'Export As saves the photo as JPEG, PNG or WebP, at the quality you pick.'],
      ['Fix the Photo', 'Rotate, crop, straighten, adjust colour and remove the background, all on your device.'],
      ['Mark It Up', 'Add arrows, shapes, text and highlights, or hide something with a redaction box.']
    ],
    faq: [
      ['What is a HEIC file?', 'HEIC (High Efficiency Image Container) is the photo format iPhones and iPads use by default. It keeps the same quality as JPEG in about half the space, but many Windows PCs and websites can’t open it.'],
      ['How do I convert HEIC to JPG?', 'Open the HEIC photo in Glance, choose Export As, pick JPEG and save. The conversion happens on your device.']
    ]
  },
  {
    slug: 'pdf-viewer',
    name: 'PDF',
    title: 'PDF Viewer',
    pageTitle: 'Open PDF Files Online: Free PDF Viewer and Editor | Glance',
    h1: 'Open, Sign and Edit PDFs Online, Free',
    description: 'View, rearrange, merge, sign and mark up PDFs in your browser or on Windows. Free, works offline, and your PDFs are never uploaded.',
    lead: 'Read, rearrange, merge, sign and mark up PDFs on any phone or computer. Glance works on your device, so your documents are never uploaded.',
    exts: ['pdf', 'ai'],
    tones: [PINK, VIOLET],
    shotAlt: 'A PDF with page thumbnails open in Glance',
    stepThree: ['Read, sign or rearrange', 'Search, add a signature or markup, drag pages to reorder them, then save or share the PDF.'],
    can: [
      ['Rearrange Pages', 'Drag pages to reorder them, rotate or delete them, and drop in pages from other PDFs or images.'],
      ['Sign and Mark Up', 'Add a signature, text, highlights, shapes and notes that other PDF apps can read.'],
      ['Redact Properly', 'Redaction removes the text and pictures underneath, not just a black box on top.']
    ],
    faq: [['Can I merge PDFs?', 'Yes. Open the first PDF, then add pages from another PDF or image with Insert, or drag them from one tab to another. Save to get one combined PDF.']]
  },
  {
    slug: 'psd-viewer',
    name: 'PSD',
    title: 'PSD Viewer',
    pageTitle: 'Open PSD Files Online Without Photoshop | Glance',
    h1: 'Open Photoshop PSD Files Without Photoshop',
    description: 'View Photoshop PSD and PSB files in your browser or on Windows, and save them as PNG or JPEG. Free, no Photoshop needed, nothing uploaded.',
    lead: 'See what is inside a PSD or PSB file on any phone or computer, and save it as PNG or JPEG. No Photoshop or account needed, and nothing is uploaded.',
    exts: ['psd', 'psb'],
    tones: [ORANGE, YELLOW],
    shotAlt: 'A Photoshop file open in Glance',
    stepThree: ['View or convert', 'Zoom in to check details, then save the image as PNG or JPEG with Export As.'],
    can: [
      ['Convert PSD to PNG', 'Export As saves the flattened image as PNG, JPEG or WebP.'],
      ['Check Details', 'Zoom in to the pixel, look at the size and colour profile in the Inspector.'],
      ['Open in Photoshop', 'In the Windows app, Open With hands the file to Photoshop or another editor to change its layers.']
    ],
    faq: [['Can I edit layers?', 'No. Glance shows the flattened image Photoshop saved inside the file. To change layers, text or effects, open the file in Photoshop or another image editor.']]
  },
  {
    slug: 'eml-msg-viewer',
    name: 'Email',
    title: 'EML and MSG Viewer',
    pageTitle: 'Open EML and MSG Email Files Online, Without Outlook | Glance',
    h1: 'Open EML and MSG Emails Without Outlook',
    description: 'Read saved .eml and Outlook .msg emails and their attachments in your browser or on Windows. Free, nothing uploaded, tracking images blocked.',
    lead: 'Read saved emails and Outlook messages on any phone or computer, and open their attachments. Nothing is uploaded, and tracking images never load.',
    exts: ['eml', 'msg'],
    tones: [VIOLET, YELLOW],
    shotAlt: 'A saved email with attachments open in Glance',
    stepThree: ['Read and open attachments', 'See the sender, recipients and date, read the message, and open any attachment in its own tab.'],
    can: [
      ['Open Attachments', 'Attached PDFs, photos and Office files open in Glance with one tap.'],
      ['Read It Safely', 'Scripts never run and pictures from the web are blocked, so the sender can’t tell you opened it.'],
      ['No Outlook Needed', 'Outlook .msg files open on a phone or Mac as easily as on Windows.']
    ],
    faq: [['What is the difference between EML and MSG?', 'EML is the standard saved-email format most mail apps use. MSG is Microsoft Outlook’s own format. Glance opens both.']]
  }
]
