<template>
  <div ref="viewport" class="viewport"></div>
</template>

<script>
import { useThreeStore } from "@/store";

export default {
  setup() {
    const store = useThreeStore();
    return { store };
  },
  data() {
    return {
      disposed: false,
    };
  },
  mounted() {
    // Named, stable handler so removeEventListener in unmount can match it.
    this.handleResize = () => {
      if (this.disposed) {
        return;
      }
      this.store.resize({
        width: this.$el.offsetWidth,
        height: this.$el.offsetHeight,
      });
    };

    this.store
      .init({
        width: this.$el.offsetWidth,
        height: this.$el.offsetHeight,
        el: this.$el,
      })
      .then(() => {
        // The component may have been unmounted again before the async init
        // resolved. In that case leave everything torn down instead of
        // starting a render loop on a dead instance.
        if (this.disposed) {
          this.store.dispose();
          return;
        }
        this.store.animate();
        // Capture phase is used so the handler also sees resize events
        // dispatched on other nodes of the page.
        window.addEventListener("resize", this.handleResize, true);
      });
  },
  beforeUnmount() {
    this.disposed = true;

    // 1. Stop listening to window resizes.
    window.removeEventListener("resize", this.handleResize, true);

    // 2. Cancel the requestAnimationFrame loop.
    this.store.stopAnimation();

    // 3. Dispose controls, renderer and scene (also removes the canvas from
    //    the DOM and releases GPU resources).
    this.store.dispose();

    // 4. Guarantee no canvas survives inside the container, so a fresh mount
    //    can never stack on top of an old one.
    if (this.$el) {
      this.$el.innerHTML = "";
    }
  },
};
</script>

<style>
.viewport {
  height: 100%;
  width: 100%;
}
</style>
