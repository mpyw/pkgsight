import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { EmbeddedDataSource, readEmbedded } from "./data/embedded";
import { HttpDataSource } from "./data/source";
import "@xyflow/react/dist/style.css";
import "./styles.css";

// A page that pkgsight export wrote carries its data. Otherwise the server
// answers.
const embedded = readEmbedded(document);
const source = embedded
  ? new EmbeddedDataSource(embedded)
  : new HttpDataSource();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App source={source} />
  </StrictMode>,
);
