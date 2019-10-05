const express = require("express");
const bodyParser = require("body-parser");
const path = require("path"); //core nodejs module
const crypto = require("crypto"); // use for generating file names
const mongoose = require("mongoose"); // ORM to interact with monogdb
const multer = require("multer");
const GridFsStorage = require("multer-gridfs-storage");
const Grid = require("gridfs-stream");
const methodOverride = require("method-override");


const Promise = require('promise')

const app = express();

//OCR
var OCRText;
var Tesseract = require('tesseract.js')
const { TesseractWorker } = Tesseract;


// Middleware

app.use(bodyParser.json());
// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }))


app.use(methodOverride("_method")); 

//set view engine
app.set("view engine", "ejs");

// Mongo URI
const mongoURI='mongodb://localhost:27017/diplomskiRad'

// Create mongo connection
const conn = mongoose.createConnection(mongoURI)

//local variables
app.locals.searchAll = false;
app.locals.search = false;

// Init gfs
let gfs;

conn.once("open", () => {
  // Init stream
  gfs = Grid(conn.db, mongoose.mongo);
  gfs.collection("documents");
  console.log("konekcija otvorena");
});

//async part
//function for creating OCR of a document
function createOCR(filename){
  return new Promise(function(resolve, reject) {
    var worker = new TesseractWorker();
    worker
      .recognize(
        filename,
        'hrv',
        {
          //tessjs_create_pdf: '1',
          tessjs_pdf_name : filename
        }
      )
      .progress((p) => {
        console.log('progress', p);
      })
      .then(({ text }) => {
        worker.terminate();
        resolve(text)
      });     
    })
}

//creating schema
var Schema = mongoose.Schema;
var OCRModelSchema = new Schema({
    fileName: String,  //heksa filename
    metadata: String,  //folder name
    date: Date,
    documentText: String
});
      
var OCRModel = conn.model('OCRDocument', OCRModelSchema );
conn.collection("ocrdocuments").createIndex({metadata:"text", documentText:"text", aliases:"text"})
 //   conn.collection("ocrdocuments").dropIndexes()

// Create storage engine
const storage = new GridFsStorage({
  url: mongoURI,
  file: (req, file) => {
    return new Promise((resolve, reject) => {
      crypto.randomBytes(16, (err, buf) => {
        if (err) {
          return reject(err);
        }
        const filename = buf.toString("hex") + path.extname(file.originalname);
        if (
          file.mimetype === "image/jpeg" ||
           file.mimetype === "image/png"
        ){
          var initializeOCRPromise = createOCR( file.originalname);
          initializeOCRPromise.then( function(result){
            console.log("OCR izvrsen")
            var newDocument = new OCRModel({fileName:filename, metadata:file.originalname.toLowerCase(),date: new Date(), documentText: result});
            newDocument.save(function (err) {
                  if (err) console.log(err);
             })
          })
        }         
        const fileInfo = {
         filename: filename,
         metadata: file.originalname.toLowerCase(),
         aliases: "folderName",
         bucketName: "documents" 
        };
        resolve(fileInfo);
      });
    });
  }
});

//we are submiting our form to upload
//use upload as our middleware so that it actually uploads to the database
const upload = multer({ storage });
var folderArray = [];


//initial view 
app.get("/", (req, res) => {
  var lastUploaded ;
  gfs.files.find().toArray((err, files) => {
   // Check if files
    if (!files || files.length === 0) {
        res.render("index", { files: false, folderArray: folderArray});
    } else {
        //reach last uploaded folder name
      lastUploaded = files[files.length - 1].metadata

        //reach all folders in databases (through aliases of documents)
      files.map(file=>{
        if(!folderArray.includes(file.aliases) && !(file.aliases === 'folderName')) {
          folderArray.push(file.aliases)
        }
      })
      res.render("index", { lastUploaded : lastUploaded, folderArray: folderArray})
    }
  });   
});

//upload selected document to the DB
app.post("/upload", upload.single("file"), (req, res) => {
  console.log("uploadanje");
  res.redirect("/");
});

//set collection info
var collectionInfo = function(name, numOfDocuments, availableSize, totalSize){
  this.name = name;
  this.numOfDocuments = numOfDocuments;
  this.availableSize = availableSize;
  this.totalSize = totalSize;
}

//promise, fill collection info
function fillCollectionInfo(info){
  return new Promise(function(resolve, reject) {
    var promise3 = new Promise(function(resolve, reject) {
      //for every collection in DB get stats info
      for (var i in conn.collections) {  
        conn.collections[i].stats(function(err, stats) {
          info.push(new collectionInfo(conn.collections[i].collectionName,stats.count,(stats.storageSize - stats.size),stats.storageSize ))
         })
        }      
    });

    //set stats info about default collection documents
    promise3.then(
      gfs.collection("documents").stats(function(err, stats){
        info.push(new collectionInfo("all documents",stats.count,(stats.storageSize - stats.size),stats.storageSize ))
        resolve(info)
      })
    )
  })
}

// get all collections in database with collections info
app.get("/collections", (req, res,next) => {  
    var collections= []
    var collInformations = fillCollectionInfo(collections)
    collInformations.then(function(result){
       collections = [...result]
       res.render("collections", {collections : collections, folderArray:folderArray});
    })
});

//render view for creating folder
//find all documents that do not have folder property
app.get("/createFolder",(req,res)=> { 
  var query = {aliases:"folderName"}
  gfs.files.find(query).toArray((err, files) => {
    res.render("createFolder", {files:files,folderArray: folderArray})
  })
})

//add changes made by "createfolder form" to the database
//for checked documents update alias tag to newFolder value 
app.post("/createFolder",(req,res)=> {  
    var newFolder = req.body.folderName; //input folder name
    var checkFiles = req.body.checkFile //checked files
    var addFiles = []

    if(checkFiles) {
      addFiles = checkFiles.toString().split(",");
      for(var i = 0; i <addFiles.length; i++){
        var myquery = {metadata:addFiles[i]};
        var newvalues = { $set: {aliases: newFolder} };
        gfs.files.updateMany(myquery, newvalues, function(err, res) {
            if (err) throw err; 
          console.log("doucments are updated");
        });
      }
    }
  //add created folder to folder array
  folderArray.push(newFolder)
  res.redirect("/createFolder")
})



//add folder property to the document
//folder = folder name
//filename= document
app.get("/addToFolder/:folder/:filename", (req, res,next) => {  
  var folder = req.params.folder;
  var file = req.params.filename

  var myquery = {metadata:file};
  var newvalues = { $set: {aliases: folder} };
  gfs.files.updateOne(myquery, newvalues, function(err, res) {
    if (err) throw err; 
    console.log("1 document updated");
  });
  
 backURL= req.header('Referer') || '/';
 res.redirect(backURL);
});


// see selected document in update form
app.get("/files/:filename", (req, res) => {
  gfs.collection("documents"); //set collection name to lookup into

  /** First check if file exists */
  gfs.files
    .find({ filename: req.params.filename })
    .toArray(function(err, files) {
      if (!files || files.length === 0) {
        return res.status(404).json({
          responseCode: 1,
          responseMessage: "error"
        });
      }
      // create read stream
      var readstream = gfs.createReadStream({
        filename: files[0].filename,
        root: "documents"
      });
      // set the proper content type
      res.set("Content-Type", files[0].contentType);
      // Return response
      return readstream.pipe(res);
    });
});

//reach all documents that are in selected folder
app.get("/folders/:folder", (req,res)=> {

  var folderName = req.params.folder
  var query = {aliases: folderName}
 
  //find all files added to selected folder
  gfs.files.find(query).toArray((err, files) => {
    if (!files || files.length === 0) {
      res.render("folders", { files: false, folderArray: folderArray, folderName:folderName});
    } else {
      files.map(file => {
        if (
          file.contentType === "image/jpeg" ||
          file.contentType === "image/png" || file.contentType === "image/jng"
        ) {
          file.isImage = true;
        } else {
          file.isImage = false;
        }
      });
     res.render("folders", {files: files, folderArray: folderArray, folderName:folderName})
    }
  })
})

//remove document from a folder
//folder = folder name
//file = document
app.get("/removeFromFolder/:folder/:file", (req,res)=> {
  var folder = req.params.folder;
  var file = req.params.file;
   
  var myquery = {aliases:folder, metadata:file};
  var newvalues = { $set: {aliases: "folderName"} };
  gfs.files.updateOne(myquery, newvalues, function(err, res) {
    if (err) throw err; 
    console.log("1 document updated");
  });

 backURL= req.header('Referer') || '/';
 res.redirect(backURL);
})

//delete folder
//remove documents folder property
app.get("/deleteFolder/:folderName", (req,res)=> {
  var folder = req.params.folderName;

  var myquery = {aliases:folder};
  var newvalues = { $set: {aliases: "folderName"} };
  gfs.files.updateMany(myquery, newvalues, function(err, res) {
    if (err) throw err; 
    console.log("documents are updated");
  });

  //remove folder name from folder array
  var promise = new Promise(function(resolve, reject){
    folderArray.forEach(item=>{
      if(item.localeCompare(folder)){
       folderArray.pop(item);
      }
    })
  }) 

  promise.then(
    res.redirect('/')
   )
})

//find all documents that have contet type = image/ 
//reach those documents
app.get("/collections/ocrdocuments", (req, res) =>{
  app.locals.search = false
  var query = {$or:[{"contentType":"image/jpeg"},{"contentType":"image/jpg"}, {"contentType" : "image/png"}]}

  gfs.files.find(query).toArray((err, files) => {
    if (!files || files.length === 0) {
      res.render("OCRdocuments", { files: false, folderArray: folderArray});
    } else {
    res.render("OCRdocuments", {files: files,folderArray: folderArray})
    }
  })
})

//render updateFile view of selected document
app.get("/updateFile/:fileName", (req,res)=>{
  conn.collection("ocrdocuments").findOne({ fileName:(`${req.params.fileName}`)}, (err, file) => {
    res.render("updateFile", {file:file, folderArray: folderArray} )
  })
})

//find selected file from DB 
//insert updated values to DB
app.post("/updateFile/:fileName", (req,res)=>{
  var hexFileName = req.params.fileName

  var folderName = req.body.folderName //updated folder name
  var text= req.body.documentText //updated document text

  var myquery = {fileName:hexFileName};
  var newvalues = { $set: {metadata: folderName,documentText:text} };
  conn.collection("ocrdocuments").updateOne(myquery, newvalues, function(err, res) {
    if (err) throw err; 
    console.log("1 document updated");
  });

  backURL= req.header('Referer') || '/';
  res.redirect(backURL);
})

//render all documents view with all documents from DB
app.get("/collections/all%20documents", (req, res) =>{ 
  app.locals.searchAll = false;
    gfs.files.find().toArray((err, files) => {
      if (!files || files.length === 0) {
        res.render("allDocuments", { files: false, folderArray: folderArray});
      } else {
        files.map(file => {
          if (
            file.contentType === "image/jpeg" ||
            file.contentType === "image/png" || file.contentType === "image/jng"
          ) {
            file.isImage = true;
          } else {
            file.isImage = false;
          }
        });
       res.render("allDocuments", {files: files,  folderArray: folderArray})
      }
    })
})

//reach documents, from all documents, that meets a search condition 
app.post("/searchAll", (req, res) => {
  app.locals.searchAll = true;
  let inputText = req.body.inputText;

  var query = {$or:[{"metadata":inputText},{"aliases":inputText}]}
  gfs.files.find(query).toArray((err, files) => {
   if (!files || files.length === 0) {
      res.render("allDocuments", { files: false, folderArray: folderArray});
   } else {
     res.render("allDocuments", {files: files,  folderArray: folderArray})
   }
  })
});

// show OCR document text of a selected document
//filename = selected document
app.get("/OCR/:filename", (req, res) => {
  var filename = req.params.filename

  conn.collection("ocrdocuments").find({ fileName : filename }, {projection: {_id : 0, documentText: 1}}).toArray((err,document)=>{ 
    var buffer
    if(document.length == 0) {
      buffer = { progress_status: 'recognizing text',
                 loading: "Please wait a few seconds and refresh page"}
    } else {
      buffer = document
    }   
    res.send(buffer);  
  }) 
})

//reach documents, from OCR documents, that meets a search condition 
app.post("/search", (req, res) => {
  app.locals.search= true;
  let inputText = req.body.inputText;

  conn.collection("ocrdocuments").find({$text:{$search:inputText}}).toArray((err,files)=> { 
    if (!files || files.length === 0) {
      res.render("ocrdocuments", { files: false, folderArray: folderArray});
    } else {
     res.render("OCRdocuments", {files: files,  folderArray: folderArray})
    }
  })
});


var ObjectId = require('mongodb').ObjectID;
// @route DELETE /files/:id
// @desc  Delete file
app.delete("/files/:id", (req, res) => {
  //find selected document, check if it is a image ( delete from OCR collection)
  gfs.collection("documents");
  gfs.files.findOne({ _id : ObjectId(`${req.params.id}`)}, (err, file) => {
    if(file.filename.endsWith(".jpeg") || file.filename.endsWith(".png") || file.filename.endsWith(".jpg")){
      conn.collection("ocrdocuments").deleteOne({fileName: file.filename}, (err, documnet) => {
              if(err) throw err;
              console.log("one document deleted")
      })
    }
  })

  //delete document from DB and all document chunks
  gfs.remove({ _id:  req.params.id, root: "documents" }, (err, gridStore) => {
    if (err) {
      return res.status(404).json({ err: err });
    }   
  }); 

  backURL= req.header('Referer') || '/';
  res.redirect(backURL);
});

const port = 5000;
app.listen(port, () => console.log(`Server started on port ${port}`));
