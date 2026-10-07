/**
 * Starts a system file drag from a window, as Finder does: the drag carries file URLs, so
 * Finder, the Dock and other apps take it as files.
 *
 * Exposes nativeStartFileDrag(viewHandle, paths, images, onEnded) → boolean, and
 * nativeReadDragPasteboard() → { changeCount, ownDrag, paths }: the files a drag going on
 * now carries, wherever it came from.
 *
 * Must be called on the main thread (Electron's main process runs JS there). The drag
 * runs in AppKit's event loop; when it ends, `onEnded` is called with what the drop did:
 * "copy", "move", "link", "delete" (the Trash in the Dock) or "none" (cancelled or refused).
 */

#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#import <AppKit/AppKit.h>

/* The drag image, in points: each item's icon, and its name in a box around the text. */
#define DRAG_LABEL_MAX_WIDTH 240
#define DRAG_LABEL_PADDING_X 6
#define DRAG_LABEL_PADDING_Y 1
/* An item the page couldn't place is drawn at the pointer, icon over name. */
#define DRAG_ICON_SIZE 64
#define DRAG_LABEL_GAP 2
#define DRAG_LABEL_FONT_SIZE 12

typedef enum {
  DRAG_ENDED_NONE = 0,
  DRAG_ENDED_COPY,
  DRAG_ENDED_MOVE,
  DRAG_ENDED_LINK,
  DRAG_ENDED_DELETE,
} drag_ended_t;

static const char *drag_ended_name(drag_ended_t ended) {
  switch (ended) {
    case DRAG_ENDED_COPY: return "copy";
    case DRAG_ENDED_MOVE: return "move";
    case DRAG_ENDED_LINK: return "link";
    case DRAG_ENDED_DELETE: return "delete";
    default: return "none";
  }
}

/* Runs on the JS thread with the operation the drop did. */
static void call_on_ended(napi_env env, napi_value callback, void *context, void *data) {
  (void)context;
  if (env == NULL || callback == NULL) {
    return;
  }
  napi_value operation;
  napi_create_string_utf8(env, drag_ended_name((drag_ended_t)(intptr_t)data), NAPI_AUTO_LENGTH,
                          &operation);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  napi_call_function(env, undefined, callback, 1, &operation, NULL);
}

/* The drag pasteboard's change count once this app's last drag had written to it: a drag
   going on with that count is this app's own. */
static NSInteger own_drag_change_count = -1;

/* ── Dragging source ─────────────────────────────────────────────── */

@interface FileTrailDragSource : NSObject <NSDraggingSource> {
 @public
  napi_threadsafe_function onEnded;
}
@end

@implementation FileTrailDragSource

- (NSDragOperation)draggingSession:(NSDraggingSession *)session
    sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
  (void)session;
  /* AppKit asks once per context, as the drag starts. */
  if (context == NSDraggingContextWithinApplication) {
    /* The page picks move or copy itself from the keys held (see below). */
    return NSDragOperationCopy | NSDragOperationMove;
  }
  /* Outside the app the drop decides, as with Finder's own drags: Finder moves on one disk
     and copies to another (⌘ is Generic, a move), ⌥⌘ makes an alias, the Dock's Trash
     trashes. */
  return NSDragOperationCopy | NSDragOperationMove | NSDragOperationGeneric | NSDragOperationLink |
         NSDragOperationDelete;
}

/* Over File Trail the keys don't narrow the drag: ⌘ would narrow it to Generic, which the
   page reads as no operation at all, and refuse the drop. The page reads ⌥ and ⌘ itself. */
- (BOOL)ignoreModifierKeysForDraggingSession:(NSDraggingSession *)session {
  (void)session;
  /* Asked again as the drag moves, unlike the operation mask, so the window under the
     pointer decides. */
  NSInteger number = [NSWindow windowNumberAtPoint:[NSEvent mouseLocation]
                       belowWindowWithWindowNumber:0];
  return [NSApp windowWithWindowNumber:number] != nil;
}

- (void)draggingSession:(NSDraggingSession *)session
           endedAtPoint:(NSPoint)screenPoint
              operation:(NSDragOperation)operation {
  (void)session;
  (void)screenPoint;
  drag_ended_t ended = DRAG_ENDED_NONE;
  if (operation & NSDragOperationDelete) {
    ended = DRAG_ENDED_DELETE;
  } else if (operation & (NSDragOperationMove | NSDragOperationGeneric)) {
    ended = DRAG_ENDED_MOVE;
  } else if (operation & NSDragOperationCopy) {
    ended = DRAG_ENDED_COPY;
  } else if (operation & NSDragOperationLink) {
    ended = DRAG_ENDED_LINK;
  }
  napi_call_threadsafe_function(onEnded, (void *)(intptr_t)ended, napi_tsfn_nonblocking);
  napi_release_threadsafe_function(onEnded, napi_tsfn_release);
  onEnded = NULL;
  /* Retained by nativeStartFileDrag for the length of the drag. */
  [self release];
}

@end

/* ── Drag image ──────────────────────────────────────────────────── */

/* The name under or beside an item's icon, as Finder draws it in a drag: white on the
   accent color in a rounded box, shortened in the middle when it is long. */
static NSImage *label_image(NSString *name, CGFloat fontSize) {
  NSMutableParagraphStyle *paragraph = [[[NSMutableParagraphStyle alloc] init] autorelease];
  paragraph.lineBreakMode = NSLineBreakByTruncatingMiddle;
  NSDictionary *attributes = @{
    NSFontAttributeName : [NSFont systemFontOfSize:fontSize],
    NSForegroundColorAttributeName : [NSColor whiteColor],
    NSParagraphStyleAttributeName : paragraph,
  };
  NSSize text = [name sizeWithAttributes:attributes];
  CGFloat textWidth = MIN(ceil(text.width), DRAG_LABEL_MAX_WIDTH - 2 * DRAG_LABEL_PADDING_X);
  NSSize size = NSMakeSize(textWidth + 2 * DRAG_LABEL_PADDING_X,
                           ceil(text.height) + 2 * DRAG_LABEL_PADDING_Y);
  NSColor *background = [NSColor selectedContentBackgroundColor];
  return [NSImage imageWithSize:size
                        flipped:NO
                 drawingHandler:^BOOL(NSRect rect) {
                   [background setFill];
                   CGFloat radius = rect.size.height / 2;
                   [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:radius
                                                    yRadius:radius] fill];
                   [name drawInRect:NSInsetRect(rect, DRAG_LABEL_PADDING_X, DRAG_LABEL_PADDING_Y)
                     withAttributes:attributes];
                   return YES;
                 }];
}

/* A picture fitted inside `box`, its proportions kept. */
static NSRect fit_rect(NSSize size, NSRect box) {
  if (size.width <= 0 || size.height <= 0) {
    return box;
  }
  CGFloat scale = MIN(box.size.width / size.width, box.size.height / size.height);
  NSSize fitted = NSMakeSize(size.width * scale, size.height * scale);
  return NSMakeRect(NSMidX(box) - fitted.width / 2, NSMidY(box) - fitted.height / 2,
                    fitted.width, fitted.height);
}

/* Gives the item its picture: `icon` in `iconRect` and `label` in `labelRect`, both in view
   coordinates, framed together. */
static void set_item_picture(NSDraggingItem *item, NSImage *icon, NSRect iconRect,
                             NSImage *label, NSRect labelRect) {
  NSRect frame = NSUnionRect(iconRect, labelRect);
  NSRect iconInFrame = NSOffsetRect(iconRect, -frame.origin.x, -frame.origin.y);
  NSRect labelInFrame = NSOffsetRect(labelRect, -frame.origin.x, -frame.origin.y);
  item.draggingFrame = frame;
  item.imageComponentsProvider = ^NSArray<NSDraggingImageComponent *> *(void) {
    NSDraggingImageComponent *iconComponent =
        [NSDraggingImageComponent draggingImageComponentWithKey:NSDraggingImageComponentIconKey];
    iconComponent.contents = icon;
    iconComponent.frame = iconInFrame;
    NSDraggingImageComponent *labelComponent =
        [NSDraggingImageComponent draggingImageComponentWithKey:NSDraggingImageComponentLabelKey];
    labelComponent.contents = label;
    labelComponent.frame = labelInFrame;
    return @[ iconComponent, labelComponent ];
  };
}

/* An item with no place on screen: its icon over its name, the pointer on the icon. */
static void set_item_picture_at_pointer(NSDraggingItem *item, NSString *path, NSView *view,
                                        NSPoint pointer) {
  NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:path];
  NSImage *label = label_image([[NSFileManager defaultManager] displayNameAtPath:path],
                               DRAG_LABEL_FONT_SIZE);
  CGFloat below = view.isFlipped ? 1 : -1;
  NSRect iconRect = NSMakeRect(pointer.x - DRAG_ICON_SIZE / 2, pointer.y - DRAG_ICON_SIZE / 2,
                               DRAG_ICON_SIZE, DRAG_ICON_SIZE);
  CGFloat labelMidY = NSMidY(iconRect) +
                      below * (DRAG_ICON_SIZE / 2 + DRAG_LABEL_GAP + label.size.height / 2);
  NSRect labelRect = NSMakeRect(pointer.x - label.size.width / 2,
                                labelMidY - label.size.height / 2, label.size.width,
                                label.size.height);
  set_item_picture(item, icon, iconRect, label, labelRect);
}

/* ── Reading the arguments ───────────────────────────────────────── */

/* Where a dragged item shows in the window, as the page measured it. */
typedef struct {
  uint32_t index;
  NSRect iconRect; /* Window points, from the top left. */
  NSRect nameRect;
  double nameFontSize;
  bool nameCentered;
  NSImage *thumbnail; /* Autoreleased; nil when the icon is shown. */
} drag_image_t;

static bool get_number(napi_env env, napi_value object, const char *name, double *out) {
  napi_value value;
  return napi_get_named_property(env, object, name, &value) == napi_ok &&
         napi_get_value_double(env, value, out) == napi_ok;
}

static bool get_rect(napi_env env, napi_value object, const char *name, NSRect *out) {
  napi_value rect;
  double x, y, width, height;
  if (napi_get_named_property(env, object, name, &rect) != napi_ok ||
      !get_number(env, rect, "x", &x) || !get_number(env, rect, "y", &y) ||
      !get_number(env, rect, "width", &width) || !get_number(env, rect, "height", &height)) {
    return false;
  }
  *out = NSMakeRect(x, y, width, height);
  return true;
}

static bool read_drag_image(napi_env env, napi_value object, drag_image_t *out) {
  double index;
  napi_value centered, thumbnail;
  bool is_buffer = false;
  if (!get_number(env, object, "index", &index) || index < 0 ||
      !get_rect(env, object, "iconRect", &out->iconRect) ||
      !get_rect(env, object, "nameRect", &out->nameRect) ||
      !get_number(env, object, "nameFontSize", &out->nameFontSize) ||
      napi_get_named_property(env, object, "nameCentered", &centered) != napi_ok ||
      napi_get_value_bool(env, centered, &out->nameCentered) != napi_ok ||
      napi_get_named_property(env, object, "thumbnail", &thumbnail) != napi_ok) {
    return false;
  }
  out->index = (uint32_t)index;
  out->thumbnail = nil;
  napi_is_buffer(env, thumbnail, &is_buffer);
  if (is_buffer) {
    void *data = NULL;
    size_t length = 0;
    napi_get_buffer_info(env, thumbnail, &data, &length);
    if (length > 0) {
      out->thumbnail =
          [[[NSImage alloc] initWithData:[NSData dataWithBytes:data length:length]] autorelease];
    }
  }
  return true;
}

/* A rect measured from the window's top left, in the view's own coordinates. */
static NSRect window_rect_in_view(NSView *view, NSRect rect) {
  if (view.isFlipped) {
    return rect;
  }
  return NSMakeRect(rect.origin.x, view.bounds.size.height - NSMaxY(rect), rect.size.width,
                    rect.size.height);
}

/* ── nativeStartFileDrag(viewHandle, paths, images, onEnded) ──────── */

static napi_value throw_type_error(napi_env env, const char *message) {
  napi_throw_type_error(env, NULL, message);
  return NULL;
}

static napi_value native_start_file_drag(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 4) {
    return throw_type_error(env, "Expected (viewHandle, paths, images, onEnded)");
  }

  void *handle_data = NULL;
  size_t handle_length = 0;
  if (napi_get_buffer_info(env, argv[0], &handle_data, &handle_length) != napi_ok ||
      handle_length < sizeof(void *)) {
    return throw_type_error(env, "viewHandle must be the window's native handle");
  }
  NSView *view = nil;
  memcpy(&view, handle_data, sizeof(void *));

  bool is_array = false;
  napi_is_array(env, argv[1], &is_array);
  if (!is_array) {
    return throw_type_error(env, "paths must be an array of strings");
  }
  napi_is_array(env, argv[2], &is_array);
  if (!is_array) {
    return throw_type_error(env, "images must be an array");
  }
  napi_valuetype callback_type;
  napi_typeof(env, argv[3], &callback_type);
  if (callback_type != napi_function) {
    return throw_type_error(env, "onEnded must be a function");
  }

  uint32_t count = 0;
  napi_get_array_length(env, argv[1], &count);
  uint32_t image_count = 0;
  napi_get_array_length(env, argv[2], &image_count);

  napi_value started_value;
  @autoreleasepool {
    NSMutableArray<NSString *> *paths = [NSMutableArray arrayWithCapacity:count];
    for (uint32_t i = 0; i < count; i++) {
      napi_value element;
      napi_get_element(env, argv[1], i, &element);
      size_t length = 0;
      if (napi_get_value_string_utf8(env, element, NULL, 0, &length) != napi_ok) {
        return throw_type_error(env, "paths must be an array of strings");
      }
      char *buffer = malloc(length + 1);
      if (!buffer) {
        return throw_type_error(env, "out of memory");
      }
      napi_get_value_string_utf8(env, element, buffer, length + 1, &length);
      NSString *path = [NSString stringWithUTF8String:buffer];
      free(buffer);
      [paths addObject:path ?: @""];
    }

    /* Each path's place on screen, where the page found one. */
    NSMutableDictionary<NSNumber *, NSValue *> *images = [NSMutableDictionary dictionary];
    drag_image_t *image_data = calloc(image_count > 0 ? image_count : 1, sizeof(drag_image_t));
    if (!image_data) {
      return throw_type_error(env, "out of memory");
    }
    for (uint32_t i = 0; i < image_count; i++) {
      napi_value element;
      napi_get_element(env, argv[2], i, &element);
      if (!read_drag_image(env, element, &image_data[i])) {
        free(image_data);
        return throw_type_error(env, "images must describe where each item shows");
      }
      if (image_data[i].index < count) {
        images[@(image_data[i].index)] = [NSValue valueWithPointer:&image_data[i]];
      }
    }

    NSWindow *window = view.window;
    /* A drag needs the button still down: a quick click can end before the request
       arrives, and a drag started after it would follow the pointer with no button. */
    bool started = false;
    if (window != nil && paths.count > 0 && ([NSEvent pressedMouseButtons] & 1) != 0) {
      NSPoint window_point = [window convertPointFromScreen:[NSEvent mouseLocation]];
      NSPoint view_point = [view convertPoint:window_point fromView:nil];
      NSEvent *drag_event = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDragged
                                               location:window_point
                                          modifierFlags:[NSEvent modifierFlags]
                                              timestamp:[[NSProcessInfo processInfo] systemUptime]
                                           windowNumber:window.windowNumber
                                                context:nil
                                            eventNumber:0
                                             clickCount:1
                                               pressure:1.0];

      NSMutableArray<NSDraggingItem *> *items = [NSMutableArray arrayWithCapacity:paths.count];
      NSRect unseen_frame = NSZeroRect;
      bool any_placed = false;
      for (uint32_t i = 0; i < paths.count; i++) {
        NSString *path = paths[i];
        NSURL *url = [NSURL fileURLWithPath:path];
        NSDraggingItem *item = [[[NSDraggingItem alloc] initWithPasteboardWriter:url] autorelease];
        drag_image_t *image = [images[@(i)] pointerValue];
        if (image != NULL) {
          /* It sets off from where it is on screen: icon and name in their places. */
          NSRect iconRect = window_rect_in_view(view, image->iconRect);
          NSRect nameRect = window_rect_in_view(view, image->nameRect);
          NSImage *icon =
              image->thumbnail ?: [[NSWorkspace sharedWorkspace] iconForFile:path];
          NSImage *label = label_image([[NSFileManager defaultManager] displayNameAtPath:path],
                                       image->nameFontSize);
          CGFloat labelX = image->nameCentered ? NSMidX(nameRect) - label.size.width / 2
                                               : NSMinX(nameRect) - DRAG_LABEL_PADDING_X;
          NSRect labelRect = NSMakeRect(labelX, NSMidY(nameRect) - label.size.height / 2,
                                        label.size.width, label.size.height);
          set_item_picture(item, icon, fit_rect(icon.size, iconRect), label, labelRect);
          if (!any_placed) {
            unseen_frame = item.draggingFrame;
            any_placed = true;
          }
        }
        [items addObject:item];
      }
      if (!any_placed) {
        /* Nothing measured: the first item at the pointer, the rest in a pile under it. */
        set_item_picture_at_pointer(items[0], paths[0], view, view_point);
        unseen_frame = items[0].draggingFrame;
      }
      for (uint32_t i = 0; i < items.count; i++) {
        if (images[@(i)] == nil && !(i == 0 && !any_placed)) {
          /* Out of sight: it goes along without a picture, as in Finder. */
          items[i].draggingFrame = unseen_frame;
        }
      }

      FileTrailDragSource *source = [[FileTrailDragSource alloc] init];
      napi_value resource_name;
      napi_create_string_utf8(env, "nativeStartFileDrag", NAPI_AUTO_LENGTH, &resource_name);
      if (napi_create_threadsafe_function(env, argv[3], NULL, resource_name, 0, 1, NULL, NULL,
                                          NULL, call_on_ended,
                                          &source->onEnded) != napi_ok) {
        [source release];
        free(image_data);
        return throw_type_error(env, "could not hold onEnded");
      }
      NSDraggingSession *session = [view beginDraggingSessionWithItems:items
                                                                 event:drag_event
                                                                source:source];
      session.animatesToStartingPositionsOnCancelOrFail = YES;
      /* Items set off from their places and gather into a stack under the pointer. */
      session.draggingFormation = NSDraggingFormationStack;
      own_drag_change_count = session.draggingPasteboard.changeCount;
      started = true;
    }
    free(image_data);
    napi_get_boolean(env, started, &started_value);
  }
  return started_value;
}

/* ── nativeReadDragPasteboard() ──────────────────────────────────── */

/* What the drag going on now carries, read from the system's drag pasteboard: the files it
   holds (file URLs only, references resolved to paths; promised files, text and links have
   none), its change count, which every new drag changes, and whether it is this app's own.
   Any window can read it while a drag is over it; the page itself only gets the files once
   they are dropped. */
static napi_value native_read_drag_pasteboard(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_create_object(env, &result);
  @autoreleasepool {
    NSPasteboard *pasteboard = [NSPasteboard pasteboardWithName:NSPasteboardNameDrag];
    NSInteger change_count = pasteboard.changeCount;
    NSArray *urls = [pasteboard readObjectsForClasses:@[ [NSURL class] ]
                                              options:@{
                                                NSPasteboardURLReadingFileURLsOnlyKey : @YES
                                              }];
    NSMutableOrderedSet<NSString *> *paths = [NSMutableOrderedSet orderedSet];
    for (NSURL *url in urls) {
      /* Finder hands out file reference URLs (file:///.file/id=…); the path is what counts. */
      NSString *path = url.filePathURL.path;
      if (path.length > 0) {
        [paths addObject:path];
      }
    }

    napi_value value;
    napi_create_int64(env, (int64_t)change_count, &value);
    napi_set_named_property(env, result, "changeCount", value);
    napi_get_boolean(env, change_count == own_drag_change_count, &value);
    napi_set_named_property(env, result, "ownDrag", value);
    napi_value list;
    napi_create_array_with_length(env, paths.count, &list);
    uint32_t index = 0;
    for (NSString *path in paths) {
      napi_create_string_utf8(env, path.UTF8String, NAPI_AUTO_LENGTH, &value);
      napi_set_element(env, list, index++, value);
    }
    napi_set_named_property(env, result, "paths", list);
  }
  return result;
}

/* Called from the main module init in native_copyfile.c. */
napi_value register_file_drag(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeStartFileDrag", NAPI_AUTO_LENGTH, native_start_file_drag,
                       NULL, &fn);
  napi_set_named_property(env, exports, "nativeStartFileDrag", fn);
  napi_create_function(env, "nativeReadDragPasteboard", NAPI_AUTO_LENGTH,
                       native_read_drag_pasteboard, NULL, &fn);
  napi_set_named_property(env, exports, "nativeReadDragPasteboard", fn);
  return exports;
}
