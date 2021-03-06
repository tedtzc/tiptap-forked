import Vue from "vue";
import { BootstrapVue, IconsPlugin } from "bootstrap-vue";
import App from "./App.vue";

// Import Bootstrap an BootstrapVue CSS files (order is important)
import "bootstrap/dist/css/bootstrap.css";
import "bootstrap-vue/dist/bootstrap-vue.css";

Vue.use(BootstrapVue);

Vue.config.productionTip = false;

new Vue({
  render: (h) => h(App)
}).$mount("#app");
