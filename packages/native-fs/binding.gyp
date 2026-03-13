{
  "targets": [
    {
      "target_name": "native-fs",
      "sources": ["src/native_copyfile.c"],
      "cflags": ["-Wall", "-Wextra", "-O2"],
      "xcode_settings": {
        "OTHER_CFLAGS": ["-Wall", "-Wextra", "-O2"]
      },
      "defines": ["NAPI_VERSION=8"]
    }
  ]
}
