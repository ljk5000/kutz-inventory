using System;
using System.Runtime.InteropServices;
using System.Text;
// Generic credentials belong to the signed-in Windows user, never to addon files.
public static class KutzCredentialStore {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Credential {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool Write(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool Delete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] static extern void CredFree(IntPtr credential);
    public static string Get(string target) {
        IntPtr ptr;
        if (!Read(target, 1, 0, out ptr)) {
            int error = Marshal.GetLastWin32Error();
            if (error == 1168) return null;
            throw new System.ComponentModel.Win32Exception(error);
        }
        try {
            var c = (Credential)Marshal.PtrToStructure(ptr, typeof(Credential));
            return Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2);
        } finally { CredFree(ptr); }
    }
    public static void Set(string target, string username, string key) {
        var bytes = Encoding.Unicode.GetBytes(key);
        if (bytes.Length > 2560) throw new ArgumentException("API key is too long.");
        var ptr = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes, 0, ptr, bytes.Length);
            var c = new Credential { Type=1, TargetName=target, UserName=username,
                CredentialBlobSize=(uint)bytes.Length, CredentialBlob=ptr, Persist=2 };
            if (!Write(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            for (int i=0; i<bytes.Length; i++) Marshal.WriteByte(ptr, i, 0);
            Array.Clear(bytes, 0, bytes.Length); Marshal.FreeHGlobal(ptr);
        }
    }
    public static void Remove(string target) {
        if (!Delete(target, 1, 0) && Marshal.GetLastWin32Error()!=1168)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
}
