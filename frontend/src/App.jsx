import DbViewer from "./pages/DbViewer";
import AdminLogs from "./pages/AdminLogs";
import Chat from "./pages/Chat";
import Call from "./pages/Call";

function App() {
  return (
    <div>
      <Call />
      <hr />
      <Chat />
      <hr />
      <DbViewer />
      <hr />
      <AdminLogs />
    </div>
  );
}

export default App;