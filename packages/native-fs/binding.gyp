{
  "targets": [
    {
      "target_name": "native-fs",
      "sources": ["src/native_copyfile.c", "src/native_fileicon.m", "src/native_foldersize.c"],
      "cflags": ["-Wall", "-Wextra", "-O2"],
      "xcode_settings": {
        "OTHER_CFLAGS": ["-Wall", "-Wextra", "-O2"],
        "OTHER_LDFLAGS": ["-framework", "AppKit"]
      },
      "defines": ["NAPI_VERSION=8"],
      "link_settings": {
        "libraries": ["-framework AppKit"]
      }
    }
  ]
}
