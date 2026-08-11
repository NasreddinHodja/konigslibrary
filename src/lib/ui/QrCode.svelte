<script lang="ts">
  import qrcode from 'qrcode-generator';

  let { data, size = 200 }: { data: string; size?: number } = $props();

  const qr = $derived.by(() => {
    const code = qrcode(0, 'M');
    code.addData(data);
    code.make();
    return code;
  });

  const moduleCount = $derived(qr.getModuleCount());

  const darkModules = $derived.by(() => {
    const cells: { row: number; col: number }[] = [];
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) cells.push({ row, col });
      }
    }
    return cells;
  });
</script>

<svg viewBox="0 0 {moduleCount} {moduleCount}" width={size} height={size} class="bg-bg text-fg">
  {#each darkModules as cell (`${cell.row}-${cell.col}`)}
    <rect x={cell.col} y={cell.row} width="1" height="1" fill="currentColor" />
  {/each}
</svg>
