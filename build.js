#!/usr/bin/node

/*
 * This script builds a document from the sources in src/
 * Usage: npm run build [-- -options]
 *
 * -d: Print debug info
 * -f path/to/source.md: Arbitrary source file
 * -n: No firstpage title
 * -p path/to/file.pdf: Publish to path/to/file.pdf
 * -s: Build the sample document
 * -t: Build the document with a full titlepage
 */

const fs = require("fs-extra")
const child = require("child_process")
const cheerio = require("cheerio")
const yaml = require("js-yaml")
const argv = require("minimist")(process.argv.slice(2))

if ("d" in argv) {
  console.log("Arguments: " + argv)
}

// Set the target document based on args
let mainDoc = ""
let buildTarget = ""
// Set the output file. -s overrides -p
if ("s" in argv) {
  // Build the sample document
  buildTarget = "sample.pdf"
} else if ("p" in argv) {
  buildTarget = argv["p"]
} else {
  buildTarget = "build/draft.pdf"
}
if ("d" in argv) {
  console.log("Build target: " + buildTarget)
}
// Set the input file. Note that -f will override the sample input of -s
if ("f" in argv) {
  mainDoc = argv["f"]
} else if ("s" in argv) {
  mainDoc = "src/sample.md"
} else {
  mainDoc = "src/main.md"
}
if ("d" in argv) {
  console.log("Source file: " + mainDoc)
}

// Parse metadata from the YAML header
let metaFile = fs.readFileSync("src/main.md", "utf8").split("...\n\n")[0]
let metadata = yaml.load(metaFile)
if ("d" in argv) {
  console.log("Metadata:")
  console.log(metadata)
}

// Parse values from metadata to set flags like -n and -t in yaml head
if (!("t" in argv) && ("titlepage" in metadata)) {
  argv["t"] = true
}
if (!("n" in argv) && ("no-article-title" in metadata)) {
  argv["n"] = true
}
if ("d" in argv) {
  console.log("New argv: " + argv)
}

// Make sure we have a directory to build into
try {
  fs.statSync("./build")
} catch (e) {
  fs.mkdirSync("./build")
  if ("d" in argv) {
    console.log("No build directory detected. Creating ./build")
  }
}

// Prebuild the paper content using Pandoc
console.log("Prebuilding HTML")
child.spawnSync("pandoc", [
  "-o",
  "build/prebuild.html",
  "--filter",
  "pandoc-citeproc",
  mainDoc,
])

// Load the HTML skeleton and the prebuild content
console.log("Building...")
const $ = cheerio.load(fs.readFileSync("src/skel.html", "utf8"))
const draft = fs.readFileSync("build/prebuild.html", "utf8")

// Assemble the paper
$("article").append(draft)
$("title").html(metadata["title"])

// Build short header from title or short title metadata
// TODO: Implement automatic sentence casing to comply with APA
if (!"short-title" in metadata || metadata["short-title"] == "") {
  if (metadata["title"].length > 50) {
    if (metadata["title"].includes(":")) {
      metadata["short-title"] = metadata["title"].split(":")[0]
    } else {
      console.log("WARN: Could not determine running head for title > 50 chars.")
      metadata["short-title"] =
        "No short title provided for title > 50 chars"
    }
  } else {
    metadata["short-title"] = metadata["title"]
  }
}
$("header").append(metadata["short-title"])

// Build title page or header block from YAML metadata
if ("t" in argv) {
  $("#short-heading-block").remove()
} else {
  $("section#title-page").remove()
  $("header#short-title").remove()
}
$(".author").html(metadata["author"])
$(".short-title").html(metadata["short-title"])
$(".course").html(metadata["course"])
$(".university").html(metadata["university"])
if ("n" in argv) {
  $("article > .title").remove()
}

// Insert the title in the appropriate places
$(".title").html(metadata["title"])

// Some additional heading tweaks for a pretty PDF index
$("article").attr("title", metadata["short-title"])

// Move references into their own section
if ($("div#refs").length) {
  $("div#refs > div").appendTo("section#main-references")
  $("div#refs").remove()
} else {
  $("section#main-references").remove()
}

// Write the built HTML draft to disk and copy over stylesheets
fs.writeFileSync("build/draft.html", $.html())
fs.copySync("src/styles", "build/styles")

// Typeset the final PDF using Prince
console.log("Typesetting PDF...")
child.spawnSync("prince", ["-o", buildTarget, "build/draft.html"])
