{
  "targets": [
    {
      "target_name": "native-fs",
      "sources": [
        "src/native_copyfile.c",
        "src/native_datestaken.m",
        "src/native_errors.c",
        "src/native_flags.c",
        "src/native_fileicon.m",
        "src/native_foldersize.c",
        "src/native_package.m",
        "src/native_rename.c",
        "src/native_thumbnail.m"
      ],
      "cflags": ["-Wall", "-Wextra", "-O2"],
      "xcode_settings": {
        "OTHER_CFLAGS": ["-Wall", "-Wextra", "-O2"],
        "OTHER_LDFLAGS": [
          "-framework",
          "AppKit",
          "-framework",
          "AVFoundation",
          "-framework",
          "CoreServices",
          "-framework",
          "Foundation",
          "-framework",
          "ImageIO",
          "-framework",
          "QuickLookThumbnailing",
          "-framework",
          "UniformTypeIdentifiers"
        ]
      },
      "defines": ["NAPI_VERSION=8"],
      "link_settings": {
        "libraries": [
          "-framework AppKit",
          "-framework AVFoundation",
          "-framework CoreServices",
          "-framework Foundation",
          "-framework ImageIO",
          "-framework QuickLookThumbnailing",
          "-framework UniformTypeIdentifiers"
        ]
      }
    }
  ]
}
