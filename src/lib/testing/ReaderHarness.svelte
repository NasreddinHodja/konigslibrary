<script lang="ts">
  import type { Component } from 'svelte';
  import { createReader, setReaderContext, type Reader } from '$lib/context';
  import type { ChapterState } from '$lib/chapter-loader';
  import type { ViewerCommands } from '$lib/commands';
  import type { ViewerProps } from '$lib/viewers/types';

  /// Mounts a viewer under a real reader, the way ReaderScreen does, and hands
  /// the test that reader and the viewer's commands.
  let {
    viewer: Viewer,
    chapter,
    ontap,
    onready
  }: {
    viewer: Component<ViewerProps, Record<string, never>, 'commands'>;
    chapter: ChapterState;
    ontap?: () => void;
    onready: (reader: Reader, commands: () => ViewerCommands | null) => void;
  } = $props();

  const reader = createReader();
  setReaderContext(reader);

  let commands: ViewerCommands | null = $state(null);
  // svelte-ignore state_referenced_locally
  onready(reader, () => commands);
</script>

<Viewer {chapter} bind:commands {ontap} />
