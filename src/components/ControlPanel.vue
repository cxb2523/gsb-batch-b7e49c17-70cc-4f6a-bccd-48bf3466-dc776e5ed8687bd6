<template>
  <div
    class="flex flex-col absolute w-64 h-auto pin-r pin-b bg-grey-darkest text-white rounded mr-2 mb-2 z-10"
  >
    <div class="p-2 mt-1">Controls</div>
    <div
      class="bg-grey-dark h-full p-3 rounded-b flex flex-col border border-grey-darkest"
    >
      <div class="border-b border-grey-darkest mb-2 pb-2">
        <p class="mb-1 text-grey-light font-bold">Scenery</p>
        <p class="flex items-center justify-between mb-1">
          Pyramids
          <input
            type="checkbox"
            name="pyramids"
            id="pyramids"
            :checked="store.pyramidsVisible"
            @change="togglePyramids"
          />
        </p>
        <p class="flex items-center justify-between">
          Axis Lines
          <input
            type="checkbox"
            name="axis-lines"
            id="axis-lines"
            :checked="store.axisLinesVisible"
            @change="toggleAxisLines"
          />
        </p>
      </div>
      <div
        v-if="store.cameraPosition"
        class="border-b border-grey-darkest mb-2 pb-2"
      >
        <p class="mb-1 text-grey-light font-bold">Camera Position</p>
        <p class="flex justify-between w-full mb-2 text-grey-light">
          X:<span class="text-white">{{ store.cameraPosition.x }}</span>
        </p>
        <p class="flex justify-between w-full mb-2 text-grey-light">
          Y:<span class="text-white">{{ store.cameraPosition.y }}</span>
        </p>
        <p class="flex justify-between w-full mb-2 text-grey-light">
          Z:<span class="text-white">{{ store.cameraPosition.z }}</span>
        </p>
        <p class="flex items-center">
          <button
            class="bg-grey-light cursor-pointer shadow p-2 mx-auto"
            @click="resetCameraPosition"
          >
            Reset Camera
          </button>
        </p>
      </div>
      <div class="flex justify-around">
        <a
          href="https://threejs.org/examples/?q=controls#misc_controls_trackball"
          target="_blank"
          class="text-grey-light no-underline hover:text-grey-lighter"
          >Original &#8599;
        </a>
        <a
          href="https://github.com/SRLabs/Vue-Three-Demo"
          target="_blank"
          class="text-grey-light no-underline hover:text-grey-lighter"
          >Github &#8599;
        </a>
      </div>
    </div>
  </div>
</template>

<script>
import { useThreeStore } from "@/store";

export default {
  setup() {
    const store = useThreeStore();
    return { store };
  },
  methods: {
    resetCameraPosition() {
      this.store.resetCamera();
    },
    // Bound to the change event (fired after the checkbox value has
    // flipped). The store flags are the single source of truth, rendered via
    // :checked, so the checkbox can never show "ticked" while the scene
    // actually hides the object (or vice versa).
    toggleAxisLines(event) {
      if (event.target.checked) {
        this.store.showAxisLines();
      } else {
        this.store.hideAxisLines();
      }
    },
    togglePyramids(event) {
      if (event.target.checked) {
        this.store.showPyramids();
      } else {
        this.store.hidePyramids();
      }
    },
  },
};
</script>
