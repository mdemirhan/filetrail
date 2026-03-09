import type { IpcRequest, IpcResponse, WriteOperationProgressEvent } from "@filetrail/contracts";

import type { TreeNodeState } from "../components/TreePane";

export type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];
export type DirectoryEntryMetadata = IpcResponse<"directory:getMetadataBatch">["items"][number];
export type ItemProperties = IpcResponse<"item:getProperties">["item"];
export type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];
export type SearchPatternMode = IpcRequest<"search:start">["patternMode"];
export type SearchMatchScope = IpcRequest<"search:start">["matchScope"];
export type CopyPastePlan = IpcResponse<"copyPaste:plan">;
export type WriteOperationResult = NonNullable<WriteOperationProgressEvent["result"]>;
export type ExplorerTreeNodeState = TreeNodeState;
