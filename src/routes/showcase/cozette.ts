// Icon bitmaps from Cozette 1.30.0 (https://github.com/the-moonwitch/Cozette),
// read from its cozette.bdf and trimmed to their lit pixels, '#' a lit
// pixel. `search` is drawn for the app on Cozette's 13px cell, its own
// magnifier being 5px. `close` is its thin x (cod-close, U+EA76); `next` its
// thin chevron (oct-chevron_right, U+F460), and `back` that mirrored;
// `zoomIn` and `zoomOut` its plain + and −.
//
// MIT License
//
// Copyright (c) 2020 Samhain <samhain@moonwit.ch> & contributors <https://github.com/the-moonwitch/Cozette/contributors>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

export const COZETTE: Record<string, string[]> = {
  library: ['.######', '.#..#.#', '.####.#', '#####.#', '####.#.', '####.#.', '######.'],
  upload: [
    '.....#.....',
    '....#.#....',
    '...#...#...',
    '#####.#####',
    '##..#.#..##',
    '##..###..##',
    '##.......##',
    '####...####',
    '#...###...#',
    '#.........#',
    '###########'
  ],
  settings: ['..#.#..', '..###..', '#######', '.##.##.', '#######', '..###..', '..#.#..'],
  back: ['....#', '...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.', '....#'],
  up: ['..#..', '.###.', '#.#.#', '..#..', '..#..', '..#..', '..#..'],
  next: ['#....', '.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...', '#....'],
  close: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  refresh: ['###..', '.##..', '#.#.#', '#...#', '#...#', '.###.'],
  search: ['.###...', '#...#..', '#...#..', '#...#..', '.###...', '....#..', '.....#.', '......#'],
  download: [
    '....###....',
    '....#.#....',
    '...##.##...',
    '####...####',
    '##..#.#..##',
    '##...#...##',
    '##.......##',
    '####...####',
    '#...###...#',
    '#.........#',
    '###########'
  ],
  delete: [
    '..##..',
    '######',
    '......',
    '######',
    '#.####',
    '###.##',
    '######',
    '#.##.#',
    '######'
  ],
  cancel: ['#####', '#####', '#####', '#####', '#####'],
  check: ['....#', '....#', '...##', '#..#.', '####.', '.##..', '..#..'],
  down: ['..#..', '..#..', '..#..', '..#..', '#.#.#', '.###.', '..#..'],
  select: ['#######', '#....##', '#...###', '##.##.#', '####..#', '#.#...#', '#######'],
  zoomIn: ['..#..', '..#..', '#####', '..#..', '..#..'],
  zoomOut: ['#####'],
  folder: ['###..', '#####', '#####', '#####', '#####'],
  copy: ['.####..', '##..#..', '#..####', '#.##..#', '#.#...#', '###...#', '..#...#', '..#####']
};
