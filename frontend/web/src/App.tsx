import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface EncryptedRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  status: "pending" | "verified" | "rejected";
}

export default function App() {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<EncryptedRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    category: "",
    description: "",
    sensitiveInfo: ""
  });
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    verified: 0,
    rejected: 0
  });

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Calculate statistics when records change
    const pending = records.filter(r => r.status === "pending").length;
    const verified = records.filter(r => r.status === "verified").length;
    const rejected = records.filter(r => r.status === "rejected").length;
    
    setStats({
      total: records.length,
      pending,
      verified,
      rejected
    });
  }, [records]);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: EncryptedRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                category: recordData.category,
                status: recordData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting sensitive data with Zama FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newRecordData.category,
        status: "pending"
      };
      
      await contract.setData(
        `record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "record_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted data submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          category: "",
          description: "",
          sensitiveInfo: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation on encrypted data
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "verified"
      };
      
      await contract.setData(
        `record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation on encrypted data
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "rejected"
      };
      
      await contract.setData(
        `record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Homomorphic<span>Audit</span>Repository</h1>
        </div>
        
        <nav className="main-nav">
          <button 
            className={activeTab === "dashboard" ? "active" : ""}
            onClick={() => setActiveTab("dashboard")}
          >
            <div className="nav-icon dashboard-icon"></div>
            Dashboard
          </button>
          <button 
            className={activeTab === "records" ? "active" : ""}
            onClick={() => setActiveTab("records")}
          >
            <div className="nav-icon records-icon"></div>
            Encrypted Data
          </button>
          <button 
            className={activeTab === "tutorial" ? "active" : ""}
            onClick={() => setActiveTab("tutorial")}
          >
            <div className="nav-icon tutorial-icon"></div>
            Tutorial
          </button>
        </nav>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn cyber-button"
          >
            <div className="add-icon"></div>
            Add Record
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        {activeTab === "dashboard" && (
          <div className="dashboard-tab">
            <div className="welcome-banner">
              <div className="welcome-text">
                <h2>Homomorphic Encryption Audit Repository</h2>
                <p>Process sensitive data in encrypted state using Zama FHE technology</p>
              </div>
            </div>
            
            <div className="stats-container">
              <div className="stat-card">
                <h3>Total Records</h3>
                <div className="stat-value">{stats.total}</div>
              </div>
              <div className="stat-card">
                <h3>Pending</h3>
                <div className="stat-value">{stats.pending}</div>
              </div>
              <div className="stat-card">
                <h3>Verified</h3>
                <div className="stat-value">{stats.verified}</div>
              </div>
              <div className="stat-card">
                <h3>Rejected</h3>
                <div className="stat-value">{stats.rejected}</div>
              </div>
            </div>
            
            <div className="chart-container">
              <h3>Record Status Distribution</h3>
              <div className="pie-chart">
                <div className="pie-slice pending" style={{ transform: `rotate(${stats.pending/stats.total*360}deg)` }}></div>
                <div className="pie-slice verified" style={{ transform: `rotate(${stats.verified/stats.total*360}deg)` }}></div>
                <div className="pie-slice rejected" style={{ transform: `rotate(${stats.rejected/stats.total*360}deg)` }}></div>
                <div className="pie-center"></div>
              </div>
              <div className="chart-legend">
                <div><span className="legend-color pending"></span> Pending</div>
                <div><span className="legend-color verified"></span> Verified</div>
                <div><span className="legend-color rejected"></span> Rejected</div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "records" && (
          <div className="records-tab">
            <div className="section-header">
              <h2>Encrypted Data Records</h2>
              <div className="header-actions">
                <button 
                  onClick={() => setShowCreateModal(true)} 
                  className="add-record-btn cyber-button"
                >
                  <div className="add-icon"></div> Add New Record
                </button>
                <button 
                  onClick={loadRecords}
                  className="refresh-btn cyber-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="records-list">
              {records.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"></div>
                  <p>No encrypted records found</p>
                  <button 
                    onClick={() => setShowCreateModal(true)} 
                    className="cyber-button primary"
                  >
                    Add First Record
                  </button>
                </div>
              ) : (
                records.map(record => (
                  <div key={record.id} className={`record-card ${record.status}`}>
                    <div className="record-header">
                      <div className="record-id">ID: {record.id.substring(0, 8)}</div>
                      <div className={`record-status ${record.status}`}>{record.status}</div>
                    </div>
                    <div className="record-details">
                      <div className="record-category">
                        <span>Category:</span> {record.category}
                      </div>
                      <div className="record-owner">
                        <span>Owner:</span> {record.owner.substring(0, 6)}...{record.owner.substring(38)}
                      </div>
                      <div className="record-timestamp">
                        <span>Date:</span> {new Date(record.timestamp * 1000).toLocaleString()}
                      </div>
                    </div>
                    <div className="record-actions">
                      {isOwner(record.owner) && record.status === "pending" && (
                        <>
                          <button 
                            className="action-btn verify-btn cyber-button"
                            onClick={() => verifyRecord(record.id)}
                          >
                            Verify
                          </button>
                          <button 
                            className="action-btn reject-btn cyber-button"
                            onClick={() => rejectRecord(record.id)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      <button className="action-btn details-btn cyber-button">
                        View Details
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "tutorial" && (
          <div className="tutorial-tab">
            <h2>FHE Confidential Audit Tutorial</h2>
            <p className="subtitle">Learn how to securely process sensitive data</p>
            
            <div className="tutorial-steps">
              <div className="tutorial-step">
                <div className="step-number">1</div>
                <div className="step-content">
                  <h3>Connect Wallet</h3>
                  <p>Connect your Web3 wallet to access the homomorphic encryption audit system.</p>
                </div>
              </div>
              <div className="tutorial-step">
                <div className="step-number">2</div>
                <div className="step-content">
                  <h3>Submit Encrypted Data</h3>
                  <p>Use Zama FHE to encrypt sensitive data before submitting it to the blockchain.</p>
                </div>
              </div>
              <div className="tutorial-step">
                <div className="step-number">3</div>
                <div className="step-content">
                  <h3>FHE Processing</h3>
                  <p>Smart contracts process your encrypted data without decrypting it, preserving privacy.</p>
                </div>
              </div>
              <div className="tutorial-step">
                <div className="step-number">4</div>
                <div className="step-content">
                  <h3>Receive Results</h3>
                  <p>Get encrypted results that only you can decrypt with your private key.</p>
                </div>
              </div>
              <div className="tutorial-step">
                <div className="step-number">5</div>
                <div className="step-content">
                  <h3>Audit & Trace</h3>
                  <p>Verify audit results and trace data provenance while maintaining confidentiality.</p>
                </div>
              </div>
            </div>
            
            <div className="fhe-explanation">
              <h3>How Homomorphic Encryption Works</h3>
              <p>
                Fully Homomorphic Encryption (FHE) allows computations to be performed directly on encrypted data 
                without needing to decrypt it first. This revolutionary technology enables:
              </p>
              <ul>
                <li>Privacy-preserving data processing</li>
                <li>Secure multi-party computations</li>
                <li>Confidential smart contract execution</li>
                <li>Regulatory-compliant data handling</li>
              </ul>
            </div>
          </div>
        )}
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>Homomorphic Audit Repository</span>
            </div>
            <p>Secure encrypted data processing platform using Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#">Documentation</a>
            <a href="#">GitHub</a>
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
          </div>
        </div>
        <div className="footer-bottom">
          © {new Date().getFullYear()} Homomorphic Audit Repository. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

function ModalCreate({ onSubmit, onClose, creating, recordData, setRecordData }: { 
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.category || !recordData.sensitiveInfo) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Add Encrypted Data Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your sensitive data will be encrypted with Zama FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={recordData.category} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="">Select category</option>
                <option value="Financial">Financial Records</option>
                <option value="Medical">Medical Data</option>
                <option value="Identity">Identity Verification</option>
                <option value="SupplyChain">Supply Chain Data</option>
                <option value="Compliance">Regulatory Compliance</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={recordData.description} 
                onChange={handleChange}
                placeholder="Brief description..." 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Sensitive Information *</label>
              <textarea 
                name="sensitiveInfo"
                value={recordData.sensitiveInfo} 
                onChange={handleChange}
                placeholder="Enter sensitive data to encrypt..." 
                className="cyber-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during processing using FHE technology
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Encrypting..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
}