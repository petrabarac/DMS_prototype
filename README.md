# Master's thesis

Prototype of DMS.
This application is used for uploading and managing documents in local MongoDB.
For every document, that have a content type of an image, OCR is automatically created.

Application allows user to:
 add new document,
 add document to a folder,
 create a new folder,
 search documents in a folder by a name,
 search OCR documents in a ocrdocuments collection by a content,
 delete folder (deleting a folder does not delete documents inside the folder),
 remove document from a folder,
 update OCR content of a document that have a content type of an image.