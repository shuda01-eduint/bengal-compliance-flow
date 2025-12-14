export interface Employee {
  id: string;
  name: string;
  designation: string;
  department: string;
  location: string;
  reportingTo: string;
  branchManager: string;
  email: string;
  phone: string;
}

export const employees: Employee[] = [
  { id: "30001", name: "Mir Masudul Hasan Chowdhury", designation: "AVP", department: "Chattogram", location: "Chattogram Branch", reportingTo: "Mohammad Monjurul Alam", branchManager: "MANCOM", email: "hasan.masudul@ucbstock.com.bd", phone: "+8801701205031" },
  { id: "30003", name: "Mahmuda Akter Dali", designation: "SEO", department: "Settlement & Support Services", location: "Head Office", reportingTo: "Belal Hossain", branchManager: "N/A", email: "mahmuda.dali@ucbstock.com.bd", phone: "+8801701205002" },
  { id: "30011", name: "Belal Hossain", designation: "FAVP", department: "Settlement & Support Services", location: "Head Office", reportingTo: "Mohammed Rahmat Pasha", branchManager: "N/A", email: "b.hossain@ucbstock.com.bd", phone: "+8801701205001" },
  { id: "30013", name: "Md. Shaiful Islam", designation: "SEO", department: "Retail Sales", location: "Extension of Head Office, Dilkusha", reportingTo: "Md. Toiubulla Chowdhury", branchManager: "N/A", email: "islam.shaiful@ucbstock.com.bd", phone: "+8801701205019" },
  { id: "30017", name: "Md. Mahmudul Alom Khan", designation: "EO", department: "Retail Sales", location: "Extension of Head Office, Dilkusha", reportingTo: "Md. Toiubulla Chowdhury", branchManager: "N/A", email: "alom.khan@ucbstock.com.bd", phone: "+8801701205009" },
  { id: "30018", name: "Kamrun Nahar", designation: "SO", department: "Finance and Accounts", location: "Chattogram Branch", reportingTo: "Mohammad Monjurul Alam", branchManager: "MANCOM", email: "nahar.kamrun@ucbstock.com.bd", phone: "+8801701205035" },
  { id: "30020", name: "S.M. Nusrat Shahab Uddin", designation: "SEO", department: "Chattogram", location: "Chattogram Branch", reportingTo: "Mohammad Monjurul Alam", branchManager: "MANCOM", email: "smnusrat.uddin@ucbstock.com.bd", phone: "+8801701205034" },
  { id: "30021", name: "Mohammed Rahmat Pasha", designation: "Managing Director & CEO", department: "Executive", location: "Head Office", reportingTo: "N/A", branchManager: "N/A", email: "pasha@ucbstock.com.bd", phone: "+8801755540040" },
  { id: "30022", name: "Md. Kazi Nazmul Hasan", designation: "FAVP", department: "Priority Brokerage Services", location: "Extension of Head Office, Nik Tower", reportingTo: "Ashfaque Mahmood", branchManager: "Ashfaque Mahmood", email: "mkazi.hasan@ucbstock.com.bd", phone: "+8801701205080" },
  { id: "30029", name: "Tahmidur Rahman", designation: "FAVP", department: "Institutional Sales, Gulshan", location: "Head Office", reportingTo: "Mohammed Rahmat Pasha", branchManager: "N/A", email: "rahman.tahmidur@ucbstock.com.bd", phone: "+8801701205004" },
  { id: "30030", name: "Arif Reza", designation: "EO", department: "Imperial Brokerage Services", location: "Head Office", reportingTo: "Misbahus Sualahin Siddiquy", branchManager: "N/A", email: "arif.reza@ucbstock.com.bd", phone: "+8801701205017" },
  { id: "30032", name: "Md. Rezaul Karim", designation: "SO", department: "Retail Sales", location: "Extension of Head Office, Dilkusha", reportingTo: "Md. Toiubulla Chowdhury", branchManager: "N/A", email: "rezaul.mkarim@ucbstock.com.bd", phone: "+8801701205022" },
  { id: "30033", name: "Muhammad Anamul Hoque", designation: "EO", department: "Corporate & HNI Sales", location: "Head Office", reportingTo: "Tamjid Khan", branchManager: "N/A", email: "manamul.hoque@ucbstock.com.bd", phone: "+8801701205016" },
  { id: "30036", name: "Md. Redoanul Haque Dolon", designation: "AVP", department: "Finance and Accounts & General Service", location: "Head Office", reportingTo: "Sazzad Mahmud", branchManager: "N/A", email: "redoanul.haque@ucbstock.com.bd", phone: "+8801701205060" },
  { id: "30039", name: "Md. Atikuzzaman", designation: "EO", department: "Retail Sales", location: "Extension of Head Office, Dilkusha", reportingTo: "Md. Toiubulla Chowdhury", branchManager: "N/A", email: "atik.zaman@ucbstock.com.bd", phone: "+8801701205024" },
  { id: "30041", name: "Azmeer Hakim", designation: "EO", department: "Retail Sales", location: "Extension of Head Office, Dilkusha", reportingTo: "Md. Toiubulla Chowdhury", branchManager: "N/A", email: "azmeer.hakim@ucbstock.com.bd", phone: "+8801701205023" },
  { id: "30045", name: "Mohammad Azizur Rahaman", designation: "SO", department: "Settlement & Support Services", location: "Head Office", reportingTo: "Belal Hossain", branchManager: "N/A", email: "mohammad.rahaman@ucbstock.com.bd", phone: "+8801701205087" },
  { id: "30046", name: "A. K. M. Iqbell Hossain", designation: "SEO", department: "HR", location: "Head Office", reportingTo: "Mohammed Rahmat Pasha", branchManager: "N/A", email: "iqbell.hossain@ucbstock.com.bd", phone: "+8801701205008" },
  { id: "30050", name: "Md. Toiubulla Chowdhury", designation: "VP", department: "Retail Sales", location: "Extension of Head Office, Dilkusha", reportingTo: "Mohammed Rahmat Pasha", branchManager: "N/A", email: "toiubulla.chowdhury@ucbstock.com.bd", phone: "+8801701205070" },
  { id: "30052", name: "Mohammad Monjurul Alam", designation: "VP", department: "Chattogram", location: "Chattogram Branch", reportingTo: "Mohammed Rahmat Pasha", branchManager: "MANCOM", email: "mmonjurul.alam@ucbstock.com.bd", phone: "+8801701205038" },
  { id: "30053", name: "Md. Atiqur Rahman", designation: "VP", department: "Extension of Head Office - DSE Tower", location: "Nikunja", reportingTo: "Mohammed Rahmat Pasha", branchManager: "Md. Atiqur Rahman", email: "mdatiqur.rahman@ucbstock.com.bd", phone: "+8801701205013" },
  { id: "30054", name: "Tamjid Khan", designation: "FAVP", department: "Corporate & HNI Sales", location: "Extension of Head Office, Dilkusha", reportingTo: "Mohammed Rahmat Pasha", branchManager: "N/A", email: "tamjid.khan@ucbstock.com.bd", phone: "+8801701205012" },
  { id: "30055", name: "Md. Aminul Haque", designation: "AVP", department: "Retail Sales", location: "Extension of Head Office, Dilkusha", reportingTo: "Md. Toiubulla Chowdhury", branchManager: "N/A", email: "aminul.haque@ucbstock.com.bd", phone: "+8801701205018" },
  { id: "30057", name: "Redwan Ahamed", designation: "AVP", department: "Digital Booth, Khatunganj", location: "Khatunganj", reportingTo: "Mohammad Monjurul Alam", branchManager: "Redwan Ahamed", email: "redwan.ahamed@ucbstock.com.bd", phone: "+8801701205037" },
  { id: "30058", name: "Md. Khurshed Alam", designation: "SO", department: "Chattogram", location: "Chattogram Branch", reportingTo: "Mohammad Monjurul Alam", branchManager: "MANCOM", email: "alam.khurshed@ucbstock.com.bd", phone: "+8801701205033" },
  { id: "30062", name: "Mohammed Rashedul Karim", designation: "FAVP", department: "Retail Sales", location: "Extension of Head Office, Dilkusha", reportingTo: "Md. Toiubulla Chowdhury", branchManager: "N/A", email: "mrashed.karim@ucbstock.com.bd", phone: "+8801701205042" },
  { id: "30067", name: "Mohammad Ruhul Islam", designation: "EO", department: "Priority Brokerage Services", location: "Extension of Head Office, Nik Tower", reportingTo: "Ashfaque Mahmood", branchManager: "Ashfaque Mahmood", email: "ruhul.Islam@ucbstock.com.bd", phone: "+8801701205046" },
  { id: "30068", name: "Pranatosh Barua", designation: "AVP", department: "Extension of Head Office, City Centre", location: "City Centre", reportingTo: "Tanvir Muhammad Tasrif", branchManager: "Kamal Hossain", email: "pranatosh.barua@ucbstock.com.bd", phone: "+8801701205047" },
  { id: "30069", name: "Moinul Islam", designation: "AVP", department: "IT", location: "Head Office", reportingTo: "Mohd. Taneem Hasan", branchManager: "N/A", email: "moinul@ucbstock.com.bd", phone: "+8801701205011" },
  { id: "30070", name: "Mohammad Yashen", designation: "SO", department: "Chattogram", location: "Chattogram Branch", reportingTo: "Mohammad Monjurul Alam", branchManager: "MANCOM", email: "mohammad.yashen@ucbstock.com.bd", phone: "+8801701205049" },
];

export const departments = [
  { name: "Retail Sales", count: 12, head: "Md. Toiubulla Chowdhury" },
  { name: "Settlement & Support Services", count: 4, head: "Belal Hossain" },
  { name: "Chattogram", count: 8, head: "Mohammad Monjurul Alam" },
  { name: "Finance and Accounts", count: 3, head: "Sazzad Mahmud" },
  { name: "Corporate & HNI Sales", count: 4, head: "Tamjid Khan" },
  { name: "IT", count: 3, head: "Mohd. Taneem Hasan" },
  { name: "HR", count: 2, head: "A. K. M. Iqbell Hossain" },
  { name: "Priority Brokerage Services", count: 5, head: "Ashfaque Mahmood" },
  { name: "Institutional Sales", count: 2, head: "Tahmidur Rahman" },
  { name: "Imperial Brokerage Services", count: 3, head: "Misbahus Sualahin Siddiquy" },
];
