<script lang="ts">
  import type { Component } from 'svelte';
  import { createReader, setReaderContext, type Reader } from '$lib/context';

  /// Mounts `component` under a real reader, the way the app's layout does,
  /// and hands the test that reader.
  let {
    component: Inner,
    onready
  }: {
    component: Component<Record<string, never>>;
    onready: (reader: Reader) => void;
  } = $props();

  const reader = createReader();
  setReaderContext(reader);
  // svelte-ignore state_referenced_locally
  onready(reader);
</script>

<Inner />
