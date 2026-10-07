/**
 * The landing page for each file type (see build-format-pages.mjs). Every claim
 * here must be true of the browser version as well as the Windows app: features
 * only the Windows app has are said to be in "the Windows app".
 *
 * shot: the page's screenshot pair in site/assets/formats/ (<slug>.webp and
 * <slug>-phone.webp), when another page's pictures fit as well.
 */
const YELLOW = '#f8d32c'
const PINK = '#f258a8'
const ORANGE = '#f47933'
const VIOLET = '#6312f6'
const PERIWINKLE = '#7182e7'

const viewStep = (what) => ['View it', what]

/** Shared with every photo format. */
const PHOTO_CAN = (name) => [
  [`Convert ${name} to JPEG or PNG`, 'Export As saves the picture as JPEG, PNG or WebP, at the quality you pick.'],
  ['Fix the Photo', 'Rotate, crop, straighten, resize and adjust colour, with a live histogram.'],
  ['Mark It Up', 'Add arrows, shapes, text and highlights, or cover something with a redaction box.']
]

export const FORMAT_PAGES = [
  {
    slug: 'pdf-viewer',
    name: 'PDF',
    title: 'PDF Viewer and Editor',
    pageTitle: 'Open and Edit PDF Files Online, Free and Private | Glance',
    h1: 'Open, Sign and Edit PDFs Online, Free',
    description: 'View, rearrange, merge, sign, redact and mark up PDFs in your browser or on Windows. Free, works offline, and your PDFs are never uploaded.',
    lead: 'Read, rearrange, merge, sign and mark up PDFs on any phone or computer. Glance works on your device, so your documents are never uploaded.',
    exts: ['pdf', 'ai'],
    tones: [PINK, VIOLET],
    shotAlt: 'A PDF with page thumbnails open in Glance',
    stepThree: ['Read, sign or rearrange', 'Search, add a signature or markup, drag pages to reorder them, then save or share the PDF.'],
    can: [
      ['Rearrange and Merge', 'Drag pages to reorder them, rotate or delete them, and add pages from other PDFs or pictures.'],
      ['Sign and Mark Up', 'Add a signature, text, highlights, shapes and notes that other PDF apps can read.'],
      ['Redact Properly', 'Redaction removes the text and pictures underneath, not just a black box on top.']
    ],
    faq: [
      ['How do I merge PDFs?', 'Open the first PDF, then add pages from another PDF or picture with Insert, or drag pages from one tab to another. Save to get one combined PDF.'],
      ['Can I fill in and sign a PDF?', 'Yes. Type text anywhere on the page and add a signature you draw, then save the PDF.']
    ]
  },
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
    can: PHOTO_CAN('HEIC'),
    faq: [
      ['What is a HEIC file?', 'HEIC (High Efficiency Image Container) is the photo format iPhones and iPads use by default. It keeps about the same quality as JPEG in a smaller file, but many Windows PCs and websites can’t open it.'],
      ['How do I convert HEIC to JPG?', 'Open the HEIC photo in Glance, choose Export As, pick JPEG and save. The conversion happens on your device.']
    ]
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
      ['Check the Details', 'Zoom in to the pixel, and see the size and colour details in the Inspector.'],
      ['Open in Photoshop', 'In the Windows app, Open With hands the file to Photoshop or another editor to change its layers.']
    ],
    faq: [['Can I edit the layers?', 'No. Glance shows the flattened image Photoshop saved inside the file. To change layers, text or effects, open it in Photoshop or another image editor.']]
  },
  {
    slug: 'raw-viewer',
    name: 'RAW',
    article: 'a',
    title: 'Camera RAW Viewer',
    pageTitle: 'Open RAW Photos Online: CR2, CR3, NEF, ARW, DNG Viewer | Glance',
    h1: 'Open Camera RAW Photos Online, Free',
    description: 'View CR2, CR3, NEF, ARW, RAF, ORF, RW2 and DNG camera RAW photos in your browser or on Windows, and save them as JPEG. Free and private.',
    lead: 'Look through the RAW photos from your Canon, Nikon, Sony, Fujifilm or other camera on any device, and save the ones you like as JPEG.',
    exts: ['cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2', 'dng', 'pef', 'srw'],
    tones: [VIOLET, ORANGE],
    shotAlt: 'A camera RAW photo open in Glance',
    stepThree: ['View or convert', 'Zoom in, check the shot, and save it as JPEG or PNG with Export As.'],
    can: PHOTO_CAN('RAW'),
    faq: [['Why does the browser show a smaller version of some RAW files?', 'Browsers have no RAW developer, so Glance shows the full-size preview the camera saved inside the file. The Windows app uses the RAW codec Windows provides, when it is installed.']]
  },
  {
    slug: 'tiff-viewer',
    name: 'TIFF',
    title: 'TIFF Viewer',
    pageTitle: 'Open TIFF Files Online, Including Multi-Page TIFF | Glance',
    h1: 'Open TIFF Images Online, Every Page',
    description: 'View single and multi-page TIFF images in your browser or on Windows, and save pages as JPEG or PNG. Free, private and works offline.',
    lead: 'Open scans, faxes and high-resolution TIFF images on any device, page by page, and save them as JPEG or PNG.',
    exts: ['tif', 'tiff'],
    tones: [PERIWINKLE, YELLOW],
    shotAlt: 'A multi-page TIFF open in Glance',
    stepThree: ['Page through and convert', 'Move between pages, zoom in, and save a page as JPEG or PNG with Export As.'],
    can: PHOTO_CAN('TIFF'),
    faq: [['Does Glance open multi-page TIFF files?', 'Yes. Each page appears in the sidebar, and you can move between them like the pages of a PDF.']]
  },
  {
    slug: 'webp-viewer',
    name: 'WebP',
    title: 'WebP and AVIF Viewer',
    pageTitle: 'Open WebP and AVIF Images, Convert to JPG or PNG | Glance',
    h1: 'Open WebP and AVIF Images, and Convert Them',
    description: 'View WebP and AVIF images saved from websites and convert them to JPEG or PNG in your browser or on Windows. Free and private.',
    lead: 'Pictures saved from the web often come as WebP or AVIF. Open them on any device and save them as JPEG or PNG for apps that need it.',
    exts: ['webp', 'avif'],
    tones: [PINK, YELLOW],
    shotAlt: 'A WebP image open in Glance',
    stepThree: ['Convert or edit', 'Crop, resize or mark it up, then save it as JPEG or PNG with Export As.'],
    can: PHOTO_CAN('WebP'),
    faq: [['How do I convert WebP to JPG?', 'Open the WebP image in Glance, choose Export As, pick JPEG and save. It is converted on your device.']]
  },
  {
    slug: 'jxl-viewer',
    name: 'JPEG XL',
    title: 'JPEG XL Viewer',
    pageTitle: 'Open JPEG XL (JXL) Images Online | Glance',
    h1: 'Open JPEG XL Images Online, Free',
    description: 'View JPEG XL (.jxl) images in your browser or on Windows, and convert them to JPEG or PNG. Free, private and works offline.',
    lead: 'Most apps can’t open JPEG XL yet. Glance can, on any device, and saves them as JPEG or PNG when you need to share.',
    exts: ['jxl'],
    tones: [YELLOW, VIOLET],
    shotAlt: 'A JPEG XL image open in Glance',
    stepThree: ['View or convert', 'Zoom in, edit or mark it up, and save it as JPEG or PNG with Export As.'],
    can: PHOTO_CAN('JXL'),
    faq: [['What is JPEG XL?', 'JPEG XL is a newer image format that makes smaller files than JPEG at the same quality and supports transparency and HDR.']]
  },
  {
    slug: 'svg-viewer',
    name: 'SVG',
    title: 'SVG Viewer',
    pageTitle: 'Open SVG Files Online and Convert SVG to PNG | Glance',
    h1: 'Open SVG Graphics and Save Them as PNG',
    description: 'View SVG vector graphics in your browser or on Windows, and save them as PNG or JPEG. Free, private and works offline.',
    lead: 'See an SVG logo or icon properly on any device, zoom in as far as you like, and save it as a PNG.',
    exts: ['svg'],
    tones: [ORANGE, PINK],
    shotAlt: 'An SVG logo open in Glance',
    stepThree: ['View or convert', 'Zoom in, then save it as PNG or JPEG with Export As.'],
    can: [
      ['Convert SVG to PNG', 'Export As saves the graphic as PNG, JPEG or WebP.'],
      ['Mark It Up', 'Add arrows, shapes and text to explain a design.'],
      ['Safe to Open', 'Scripts inside SVG files never run in Glance.']
    ],
    faq: []
  },
  {
    slug: 'docx-viewer',
    name: 'Word',
    title: 'Word Document Viewer',
    pageTitle: 'Open Word DOCX Files Online Without Word | Glance',
    h1: 'Open Word Documents Without Word',
    description: 'Read Word .docx documents in your browser or on Windows, with their pictures, tables and layout. Free, no Microsoft account, nothing uploaded.',
    lead: 'Read a Word document someone sent you on any phone or computer, laid out page by page. No Word, no account, and nothing is uploaded.',
    exts: ['docx', 'docm', 'dotx', 'dotm'],
    tones: [PERIWINKLE, PINK],
    shotAlt: 'A Word document open in Glance',
    stepThree: viewStep('Read it page by page, zoom in, and share or print it.'),
    can: [
      ['Pages as in Word', 'Headings, pictures, tables and page breaks appear as the document was written.'],
      ['Zoom and Share', 'Zoom in to read small print, share the file or print it.'],
      ['Edit in Word', 'In the Windows app, Open With hands the document to Word or another word processor.']
    ],
    faq: [['Can I edit Word documents in Glance?', 'Glance shows a read-only preview. To change the text, open the document in Word or another word processor. Older .doc files are not supported.']]
  },
  {
    slug: 'pptx-viewer',
    name: 'PowerPoint',
    title: 'PowerPoint Viewer',
    pageTitle: 'Open PowerPoint PPTX Files Online Without PowerPoint | Glance',
    h1: 'Open PowerPoint Slides Without PowerPoint',
    description: 'View PowerPoint .pptx presentations in your browser or on Windows, with pictures, charts and tables. Free, no account, nothing uploaded.',
    lead: 'Flip through a presentation on any phone or computer, slide by slide. No PowerPoint, no account, and nothing is uploaded.',
    exts: ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'],
    tones: [ORANGE, VIOLET],
    shotAlt: 'A PowerPoint presentation open in Glance',
    stepThree: viewStep('Scroll through the slides, zoom in, and share the file.'),
    can: [
      ['Every Slide', 'Text, pictures, charts and tables, one slide after another.'],
      ['Jump Around', 'Go straight to any slide from the Go menu or the page counter.'],
      ['Edit in PowerPoint', 'In the Windows app, Open With hands the deck to PowerPoint or another presentation app.']
    ],
    faq: [['Does Glance play animations?', 'No. Glance shows each slide as it looks when it is finished. To present with animations, open the file in PowerPoint. Older .ppt files are not supported.']]
  },
  {
    slug: 'xlsx-viewer',
    name: 'Excel',
    article: 'an',
    title: 'Excel Spreadsheet Viewer',
    pageTitle: 'Open Excel XLSX Files Online Without Excel | Glance',
    h1: 'Open Excel Spreadsheets Without Excel',
    description: 'View Excel .xlsx workbooks in your browser or on Windows, every sheet with its formatting. Free, no Microsoft account, nothing uploaded.',
    lead: 'Check a spreadsheet on any phone or computer, every sheet with its number formats, colours and merged cells. No Excel needed.',
    exts: ['xlsx', 'xlsm', 'xltx', 'xltm'],
    tones: [YELLOW, ORANGE],
    shotAlt: 'An Excel workbook open in Glance',
    stepThree: viewStep('Switch between sheets with the tabs at the bottom, and zoom in.'),
    can: [
      ['Every Sheet', 'Tabs for each sheet, with the column letters and row numbers you know.'],
      ['Formatting Kept', 'Number and date formats, bold text, fill colours and merged cells.'],
      ['Edit in Excel', 'In the Windows app, Open With hands the workbook to Excel or another spreadsheet app.']
    ],
    faq: [['Does Glance recalculate formulas?', 'Glance shows the values Excel saved in the file. Charts are not shown. To change cells, open the file in Excel. Older .xls files are not supported.']]
  },
  {
    slug: 'csv-viewer',
    name: 'CSV',
    title: 'CSV Viewer',
    pageTitle: 'Open CSV Files Online as a Table | Glance',
    h1: 'Open CSV Files as a Clean Table',
    description: 'View CSV and TSV files as a spreadsheet-style table in your browser or on Windows. Free, private, nothing uploaded.',
    lead: 'See a CSV export as a tidy table on any device, with quoted fields and commas handled properly.',
    exts: ['csv', 'tsv'],
    tones: [PINK, ORANGE],
    shotAlt: 'A CSV file shown as a table in Glance',
    stepThree: viewStep('Scroll the table, with column letters and row numbers that stay in place.'),
    can: [
      ['A Real Table', 'Columns line up, numbers align right, and quoted fields with commas stay in one cell.'],
      ['Big Files', 'Thousands of rows open on your device without an upload.'],
      ['Open in Excel', 'In the Windows app, Open With hands the file to Excel or another spreadsheet app.']
    ],
    faq: []
  },
  {
    slug: 'epub-reader',
    name: 'EPUB',
    article: 'an',
    title: 'EPUB Reader',
    pageTitle: 'Read EPUB E-Books Online, Free | Glance',
    h1: 'Read EPUB E-Books in Your Browser',
    description: 'Read EPUB e-books in your browser or on Windows, with their pictures and contents links. Free, private and works offline.',
    lead: 'Open an EPUB book on any phone or computer and start reading. Chapters flow one after another, and nothing is uploaded.',
    exts: ['epub'],
    tones: [VIOLET, PINK],
    shotAlt: 'An EPUB book open in Glance',
    stepThree: ['Read', 'Scroll through the chapters, jump with the contents links or the Go menu, and zoom the text.'],
    can: [
      ['Chapter by Chapter', 'The Go menu and page counter move a chapter at a time.'],
      ['Pictures Included', 'Illustrations inside the book appear in place.'],
      ['Comfortable Reading', 'A clear serif text column, zoom, and dark mode.']
    ],
    faq: [['Does it open DRM-protected books?', 'No. Books with copy protection from a store only open in that store’s reading app.']]
  },
  {
    slug: 'eml-msg-viewer',
    name: 'Email',
    article: 'an',
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
  },
  {
    slug: 'markdown-viewer',
    name: 'Markdown',
    title: 'Markdown Viewer',
    pageTitle: 'Open Markdown (.md) Files Online, Formatted | Glance',
    h1: 'Read Markdown Files, Nicely Formatted',
    description: 'View .md Markdown files formatted, with tables, task lists and coloured code, in your browser or on Windows. Free and private.',
    lead: 'Read a README or notes file the way it was meant to look, with headings, tables, task lists and coloured code blocks.',
    exts: ['md', 'markdown'],
    tones: [YELLOW, PERIWINKLE],
    shotAlt: 'A Markdown file formatted in Glance',
    stepThree: viewStep('Read it formatted, zoom in, and switch to dark mode if you like.'),
    can: [
      ['GitHub-Style Markdown', 'Tables, task lists, strikethrough and fenced code blocks.'],
      ['Coloured Code', 'Code blocks are coloured by language.'],
      ['Private by Design', 'Pictures from the web don’t load until you choose to open them.']
    ],
    faq: []
  },
  {
    slug: 'code-viewer',
    name: 'Code',
    title: 'Code and Text Viewer',
    pageTitle: 'Open JSON, XML, Code and Text Files Online | Glance',
    h1: 'Open Code, JSON and Text Files Online',
    description: 'View JSON, XML, YAML, logs and source code with line numbers and colours in your browser or on Windows. Free and private.',
    lead: 'Open a JSON export, a config file, a log or a script on any device, with line numbers and colours, and long one-line JSON laid out for reading.',
    exts: ['json', 'xml', 'yaml', 'log', 'txt', 'py', 'js', 'ts', 'cs', 'sql'],
    tones: [VIOLET, YELLOW],
    shotAlt: 'A Python file with coloured code in Glance',
    stepThree: viewStep('Scroll the file with line numbers, zoom in, and copy what you need.'),
    can: [
      ['90+ File Types', 'From JSON, XML and YAML to Python, C#, Rust, SQL and shell scripts.'],
      ['Readable JSON', 'JSON saved on one long line is laid out with indents.'],
      ['Any Encoding', 'UTF-8, UTF-16 and older Windows text files show the right characters.']
    ],
    faq: []
  },
  {
    slug: '3d-model-viewer',
    name: '3D Model',
    article: 'a',
    title: '3D Model Viewer',
    pageTitle: 'Open STL, OBJ, GLB and FBX 3D Models Online | Glance',
    h1: 'Open 3D Models Online, Free',
    description: 'View STL, OBJ, GLB, glTF, FBX, 3MF, PLY and USDZ 3D models in your browser or on Windows. Orbit, wireframe and snapshots. Free and private.',
    lead: 'Check a 3D print or a model from a designer on any device. Spin it around, look at the wireframe, and save a picture of the view.',
    exts: ['stl', 'obj', 'glb', 'gltf', 'fbx', '3mf', 'ply', 'usdz', 'dae', '3ds'],
    tones: [ORANGE, PERIWINKLE],
    shotAlt: 'A 3D model open in Glance',
    stepThree: ['Explore it', 'Drag to orbit, pinch or scroll to zoom, switch to wireframe, and export a snapshot.'],
    can: [
      ['Orbit and Zoom', 'Turn the model with a finger or the mouse, and snap to front, side or top views.'],
      ['Wireframe and Grid', 'See the mesh, a floor grid and shadows, or let it rotate on its own.'],
      ['Snapshots', 'Export the current view as a picture.']
    ],
    faq: [['Can I check an STL before 3D printing?', 'Yes. Open it to see its shape and size from every side before you send it to the slicer.']]
  },
  {
    slug: 'font-viewer',
    name: 'Font',
    article: 'a',
    title: 'Font Viewer',
    pageTitle: 'Preview TTF, OTF and WOFF Fonts Online | Glance',
    h1: 'Preview Fonts Before You Install Them',
    description: 'Preview TTF, OTF, WOFF and WOFF2 fonts in your browser or on Windows, with your own sample text. Nothing is installed or uploaded.',
    lead: 'See what a font looks like at every size, type your own words to try it, and only install the ones you like.',
    exts: ['ttf', 'otf', 'woff', 'woff2'],
    tones: [PINK, PERIWINKLE],
    shotAlt: 'A font sample sheet in Glance',
    stepThree: ['Try it', 'Type your own text and see it from 12 to 72 points, with the full alphabet and numbers.'],
    can: [
      ['Type to Try', 'Your words appear in the font at six sizes as you type.'],
      ['Font Details', 'The family, style, version and designer from inside the file.'],
      ['Nothing Installed', 'The font is only loaded into Glance while you look at it.']
    ],
    faq: []
  },
  {
    slug: 'video-player',
    name: 'Video',
    article: 'a',
    title: 'Video and Audio Player',
    pageTitle: 'Play MP4, MOV, MKV, WebM and MP3 Files Online | Glance',
    h1: 'Play Videos and Music Without Uploading',
    description: 'Play MP4, MOV, MKV, WebM video and MP3, M4A, FLAC, WAV audio in your browser or on Windows. Free, private and works offline.',
    lead: 'Play a video or song from your phone or computer straight away, alongside your documents and photos. Nothing is uploaded.',
    exts: ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'm4a', 'flac', 'wav', 'ogg'],
    tones: [VIOLET, ORANGE],
    shotAlt: 'A video playing in Glance',
    stepThree: ['Play it', 'Play, pause, seek and go full screen with the familiar controls.'],
    can: [
      ['Video and Music', 'MP4, MOV, MKV and WebM video, and MP3, M4A, FLAC, WAV and Ogg audio.'],
      ['Full Screen', 'Watch in full screen or picture-in-picture where your browser offers it.'],
      ['With Your Files', 'Videos open in a tab next to your PDFs and photos.']
    ],
    faq: [['Why won’t a video play?', 'Glance plays video with your browser’s or Windows’ own codecs. A file in a format they don’t support, such as some MKV files, shows a message instead.']]
  },
  {
    slug: 'cbz-reader',
    name: 'CBZ',
    title: 'CBZ Comic Reader',
    pageTitle: 'Read CBZ Comic Book Files Online | Glance',
    h1: 'Read CBZ Comics in Your Browser',
    description: 'Read CBZ comic book archives page by page in your browser or on Windows. Free, private and works offline.',
    lead: 'Open a comic book archive on any phone, tablet or computer and read it page by page.',
    exts: ['cbz'],
    tones: [YELLOW, PINK],
    shotAlt: 'A comic book open in Glance',
    stepThree: ['Read', 'Turn the pages with the arrows or the sidebar, and zoom into panels.'],
    can: [
      ['Page by Page', 'Every picture in the archive becomes a page, in order.'],
      ['Thumbnails', 'Jump to any page from the sidebar.'],
      ['Zoom Into Panels', 'Pinch or scroll to zoom into the art.']
    ],
    faq: []
  }
]

/** The "open any file" page: every kind of file, grouped, linking to the pages above. */
export const HUB = {
  slug: 'file-viewer',
  title: 'Online File Viewer and Editor',
  pageTitle: 'Open and Edit Any File Online, Free and Private | Glance',
  h1: 'Open and Edit Any File Online, Free',
  description: 'Open PDFs, photos, HEIC, RAW, PSD, Word, Excel, PowerPoint, 3D models, e-books and 190+ formats in your browser, and edit PDFs and images. Nothing is uploaded.',
  lead: 'PDFs, photos, Photoshop and RAW files, Word, Excel and PowerPoint, 3D models, e-books, email and more: over 190 file types open right here, and nothing is uploaded.',
  groups: [
    { name: 'Documents', tone: PINK, items: [['PDF', 'pdf-viewer'], ['Word', 'docx-viewer'], ['PowerPoint', 'pptx-viewer'], ['Excel', 'xlsx-viewer'], ['CSV', 'csv-viewer'], ['Markdown', 'markdown-viewer'], ['Illustrator AI', 'pdf-viewer']] },
    { name: 'Photos and Images', tone: YELLOW, items: [['HEIC', 'heic-viewer'], ['Camera RAW', 'raw-viewer'], ['Photoshop PSD', 'psd-viewer'], ['TIFF', 'tiff-viewer'], ['WebP', 'webp-viewer'], ['AVIF', 'webp-viewer'], ['JPEG XL', 'jxl-viewer'], ['SVG', 'svg-viewer'], ['JPEG'], ['PNG'], ['GIF'], ['BMP'], ['ICO'], ['JPEG 2000'], ['OpenEXR'], ['HDR'], ['TGA'], ['DDS'], ['QOI']] },
    { name: '3D Models', tone: ORANGE, items: [['STL', '3d-model-viewer'], ['OBJ', '3d-model-viewer'], ['GLB and glTF', '3d-model-viewer'], ['FBX', '3d-model-viewer'], ['3MF', '3d-model-viewer'], ['PLY', '3d-model-viewer'], ['USDZ', '3d-model-viewer'], ['DAE'], ['3DS']] },
    { name: 'Reading', tone: VIOLET, items: [['EPUB', 'epub-reader'], ['CBZ Comics', 'cbz-reader'], ['Email EML and MSG', 'eml-msg-viewer']] },
    { name: 'Code and Text', tone: PERIWINKLE, items: [['JSON', 'code-viewer'], ['XML', 'code-viewer'], ['YAML', 'code-viewer'], ['Logs', 'code-viewer'], ['Python', 'code-viewer'], ['JavaScript', 'code-viewer'], ['C#', 'code-viewer'], ['SQL', 'code-viewer']] },
    { name: 'Media and Fonts', tone: PINK, items: [['MP4', 'video-player'], ['MOV', 'video-player'], ['MKV', 'video-player'], ['MP3', 'video-player'], ['FLAC', 'video-player'], ['TTF and OTF', 'font-viewer'], ['WOFF', 'font-viewer']] }
  ],
  edit: [
    ['Edit PDFs', 'Rearrange, rotate, merge and split pages, sign, fill in, mark up and redact.', PINK],
    ['Edit Photos', 'Crop, straighten, resize, adjust colour, mark up and convert between JPEG, PNG and WebP.', YELLOW],
    ['View Everything Else', 'Office files, 3D models, books, email, code, video and fonts, with zoom, share and print.', ORANGE]
  ]
}
